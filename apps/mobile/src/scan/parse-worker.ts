import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import {
  MAX_PARSE_ATTEMPTS,
  MAX_RATE_LIMIT_ATTEMPTS,
  type ParseState,
  type ScanDraft,
  canRetryParse,
  isAwaitingParse,
} from "./model";
import { type ScanParseError, parseProductScan } from "./parse-client";

export type ParseEnvironment = {
  readonly online: boolean;
  readonly fetch: typeof globalThis.fetch | null;
};

export type ScanWorkerHost = {
  readonly apiBaseUrl: string;
  readonly drafts: () => ReadonlyMap<string, ScanDraft>;
  readonly environment: () => ParseEnvironment;
  readonly setParse: (draftId: string, parse: ParseState) => void;
  readonly setParsing: (draftId: string, parsing: boolean) => void;
};

export type ScanQueues = {
  readonly requests: Queue.Queue<string>;
  readonly changes: Queue.Queue<void>;
  readonly request: (draftId: string) => void;
  readonly settle: (draftId: string) => void;
  readonly changed: () => void;
};

const MAX_WAKE_SLEEP = Duration.hours(12);

export const RATE_LIMIT_EXHAUSTED_REASON = "Auto-fill is busy right now.";

export const makeScanQueues = (): ScanQueues => {
  const requests = Effect.runSync(Queue.unbounded<string>());
  const changes = Effect.runSync(Queue.sliding<void>(1));
  const pending = new Set<string>();
  return {
    requests,
    changes,
    request: (draftId) => {
      if (pending.has(draftId)) return;
      pending.add(draftId);
      Queue.offerUnsafe(requests, draftId);
    },
    settle: (draftId) => {
      pending.delete(draftId);
    },
    changed: () => {
      Queue.offerUnsafe(changes, undefined);
    },
  };
};

export const eligibleForParse = (draft: ScanDraft, now: number): boolean => {
  const { parse } = draft;
  if (parse._tag === "RateLimited") return parse.retryAt <= now;
  return isAwaitingParse(parse) || canRetryParse(parse);
};

export const parseStateAfter = (
  exit: Exit.Exit<ParseState, ScanParseError>,
  previous: ParseState,
): ParseState => {
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  const attempts = previous._tag === "Failed" ? previous.attempts + 1 : 1;
  if (failure?._tag !== "Fail") {
    return { _tag: "Failed", attempts, reason: "Auto-fill stopped unexpectedly." };
  }
  switch (failure.error._tag) {
    case "ScanOffline":
      return { _tag: "Deferred" };
    case "ScanRateLimited": {
      const limited = (previous._tag === "RateLimited" ? (previous.attempts ?? 1) : 0) + 1;
      return limited >= MAX_RATE_LIMIT_ATTEMPTS
        ? { _tag: "Failed", attempts: 0, reason: RATE_LIMIT_EXHAUSTED_REASON }
        : { _tag: "RateLimited", retryAt: failure.error.retryAt, attempts: limited };
    }
    case "ScanFailed":
      return { _tag: "Failed", attempts, reason: failure.error.message };
    case "ScanRejected":
      return { _tag: "Failed", attempts: MAX_PARSE_ATTEMPTS, reason: failure.error.message };
  }
};

export const nextRetryDeadline = (
  drafts: Iterable<ScanDraft>,
  handledThrough: number,
): number | null => {
  let earliest: number | null = null;
  for (const { parse } of drafts) {
    if (parse._tag !== "RateLimited" || parse.retryAt <= handledThrough) continue;
    if (earliest === null || parse.retryAt < earliest) earliest = parse.retryAt;
  }
  return earliest;
};

export const dueDraftIds = (drafts: Iterable<ScanDraft>, now: number): ReadonlyArray<string> => {
  const ids: Array<string> = [];
  for (const draft of drafts) {
    if (draft.parse._tag === "RateLimited" && draft.parse.retryAt <= now) ids.push(draft.id);
  }
  return ids;
};

const sameInput = (left: ScanDraft, right: ScanDraft) =>
  left.recognizedText === right.recognizedText && left.mode === right.mode;

const parseDraft = (host: ScanWorkerHost, draftId: string) =>
  Effect.gen(function* () {
    const draft = host.drafts().get(draftId);
    if (!draft || !eligibleForParse(draft, yield* Clock.currentTimeMillis)) return;
    const environment = host.environment();
    if (!environment.online || environment.fetch === null) {
      host.setParse(draftId, { _tag: "Deferred" });
      return;
    }
    if (!draft.recognizedText.trim()) {
      host.setParse(draftId, { _tag: "Manual" });
      return;
    }
    host.setParsing(draftId, true);
    const exit = yield* parseProductScan(host.apiBaseUrl, {
      recognizedText: draft.recognizedText,
      mode: draft.mode,
    }).pipe(
      Effect.flatMap((result) =>
        Effect.map(Clock.currentTimeMillis, (parsedAt): ParseState => ({
          _tag: "Parsed",
          result,
          parsedAt,
        })),
      ),
      Effect.provideService(FetchHttpClient.Fetch, environment.fetch),
      Effect.exit,
      Effect.ensuring(Effect.sync(() => host.setParsing(draftId, false))),
    );
    const latest = host.drafts().get(draftId);
    if (latest && sameInput(draft, latest)) {
      host.setParse(draftId, parseStateAfter(exit, latest.parse));
    }
  });

const parseLoop = (host: ScanWorkerHost, queues: ScanQueues) =>
  Effect.forever(
    Queue.take(queues.requests).pipe(
      Effect.flatMap((draftId) => {
        queues.settle(draftId);
        return parseDraft(host, draftId);
      }),
      Effect.catchCause((cause) => Effect.logError("Scan auto-fill stopped for a draft", cause)),
    ),
  );

const wakeLoop = (host: ScanWorkerHost, queues: ScanQueues) =>
  Effect.gen(function* () {
    let handledThrough = Number.NEGATIVE_INFINITY;
    return yield* Effect.forever(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const deadline = nextRetryDeadline(host.drafts().values(), handledThrough);
        if (deadline === null) return yield* Queue.take(queues.changes);
        const delay = Duration.min(Duration.millis(Math.max(0, deadline - now)), MAX_WAKE_SLEEP);
        const changed = yield* Queue.take(queues.changes).pipe(Effect.timeoutOption(delay));
        if (Option.isSome(changed)) return;
        const fired = yield* Clock.currentTimeMillis;
        handledThrough = fired;
        for (const draftId of dueDraftIds(host.drafts().values(), fired)) queues.request(draftId);
      }),
    );
  });

export const runScanWorker = (host: ScanWorkerHost, queues: ScanQueues) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.forkScoped(wakeLoop(host, queues));
      return yield* parseLoop(host, queues);
    }),
  );
