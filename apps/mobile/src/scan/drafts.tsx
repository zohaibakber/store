import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { useNetworkState } from "expo-network";
import * as React from "react";

import { useSession } from "@/auth";

import { DraftStore, fileDraftStore } from "./draft-store";
import { sameEdits } from "./fields";
import {
  MAX_PARSE_ATTEMPTS,
  type ParseState,
  type ProductScanMode,
  type ReviewEdits,
  type ScanDraft,
  canRetryParse,
  isAwaitingParse,
} from "./model";
import { type ScanParseError, parseProductScan } from "./parse-client";

export type NewDraft = {
  readonly mode: ProductScanMode;
  readonly capturedPath: string | null;
  readonly recognizedText: string;
  readonly lines: ReadonlyArray<string>;
};

export type ScanDrafts = {
  readonly drafts: ReadonlyArray<ScanDraft>;
  readonly loaded: boolean;
  readonly parsing: ReadonlySet<string>;
  readonly pausedUntil: number | null;
  readonly online: boolean;
  readonly lastCommit: string | null;
  readonly createDraft: (input: NewDraft) => Promise<ScanDraft>;
  readonly requestParse: (draftId: string) => void;
  readonly setPacks: (draftId: string, packs: number) => void;
  readonly setParse: (draftId: string, parse: ParseState) => void;
  readonly saveEdits: (draftId: string, edits: ReviewEdits) => void;
  readonly removeDraft: (draftId: string) => void;
  readonly noteCommit: (message: string) => void;
};

const ScanDraftsContext = React.createContext<ScanDrafts | null>(null);

const ExpoExtra = Schema.Struct({ apiBaseUrl: Schema.String });

const apiBaseUrl = Option.getOrNull(
  Option.map(
    Schema.decodeUnknownOption(ExpoExtra)(Constants.expoConfig?.extra),
    (extra) => extra.apiBaseUrl,
  ),
);

type ParseEnvironment = {
  readonly online: boolean;
  readonly fetch: typeof globalThis.fetch | null;
};

const storeLock = Semaphore.makeUnsafe(1);

const runStore = <A,>(effect: Effect.Effect<A, Error, DraftStore>) =>
  Effect.runPromise(storeLock.withPermits(1)(effect).pipe(Effect.provide(fileDraftStore)));

const persist = (draft: ScanDraft) =>
  Effect.runFork(
    storeLock
      .withPermits(1)(DraftStore.use((store) => store.save(draft)))
      .pipe(
        Effect.provide(fileDraftStore),
        Effect.tapError((error) => Effect.logError("Scan draft not saved", error)),
        Effect.ignore,
      ),
  );

const eligibleForParse = (draft: ScanDraft, now: number): boolean => {
  const { parse } = draft;
  if (parse._tag === "RateLimited") return parse.retryAt <= now;
  return isAwaitingParse(parse) || canRetryParse(parse);
};

const parseStateAfter = (
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
    case "ScanRateLimited":
      return { _tag: "RateLimited", retryAt: failure.error.retryAt };
    case "ScanFailed":
      return { _tag: "Failed", attempts, reason: failure.error.message };
    case "ScanRejected":
      return { _tag: "Failed", attempts: MAX_PARSE_ATTEMPTS, reason: failure.error.message };
  }
};

function DraftsProvider({ children }: { readonly children: React.ReactNode }) {
  const session = useSession();
  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const fetch = session.status === "signedIn" ? session.authenticatedFetch : null;

  const [drafts, setDrafts] = React.useState<ReadonlyMap<string, ScanDraft>>(() => new Map());
  const [loaded, setLoaded] = React.useState(false);
  const [parsing, setParsing] = React.useState<ReadonlySet<string>>(() => new Set());
  const [pausedUntil, setPausedUntil] = React.useState<number | null>(null);
  const [lastCommit, setLastCommit] = React.useState<string | null>(null);

  const draftsRef = React.useRef(drafts);
  const environmentRef = React.useRef<ParseEnvironment>({ online, fetch });
  const [queue] = React.useState(() => Effect.runSync(Queue.unbounded<string>()));

  React.useEffect(() => {
    environmentRef.current = { online, fetch };
  }, [online, fetch]);

  const commitDrafts = React.useCallback(
    (next: (current: ReadonlyMap<string, ScanDraft>) => ReadonlyMap<string, ScanDraft>) => {
      draftsRef.current = next(draftsRef.current);
      setDrafts(draftsRef.current);
    },
    [],
  );

  const writeDraft = React.useCallback(
    (draft: ScanDraft) => {
      commitDrafts((current) => new Map(current).set(draft.id, draft));
      persist(draft);
    },
    [commitDrafts],
  );

  const setParse = React.useCallback(
    (draftId: string, parse: ParseState) => {
      const draft = draftsRef.current.get(draftId);
      if (draft) writeDraft({ ...draft, parse, updatedAt: Date.now() });
    },
    [writeDraft],
  );

  const requestParse = React.useCallback(
    (draftId: string) => {
      Queue.offerUnsafe(queue, draftId);
    },
    [queue],
  );

  React.useEffect(() => {
    let active = true;
    void runStore(DraftStore.use((store) => store.list)).then(
      (stored) => {
        if (!active) return;
        commitDrafts((current) => {
          const merged = new Map(stored.map((draft) => [draft.id, draft] as const));
          for (const [id, draft] of current) merged.set(id, draft);
          return merged;
        });
        setLoaded(true);
      },
      () => {
        if (active) setLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [commitDrafts]);

  React.useEffect(() => {
    const rateLimitRetry = Schedule.recurs(3).pipe(
      Schedule.setInputType<ScanParseError>(),
      Schedule.modifyDelay(({ input, now }) =>
        Effect.succeed(
          input._tag === "ScanRateLimited" ? Duration.millis(Math.max(0, input.retryAt - now)) : 0,
        ),
      ),
      Schedule.tap(({ input }) =>
        Effect.sync(() => {
          if (input._tag !== "ScanRateLimited") return;
          setPausedUntil(input.retryAt);
        }),
      ),
    );

    const parseDraft = (draftId: string) =>
      Effect.gen(function* () {
        const draft = draftsRef.current.get(draftId);
        if (!draft || !eligibleForParse(draft, Date.now())) return;
        const environment = environmentRef.current;
        if (!environment.online || environment.fetch === null || apiBaseUrl === null) {
          setParse(draftId, { _tag: "Deferred" });
          return;
        }
        if (!draft.recognizedText.trim()) {
          setParse(draftId, { _tag: "Manual" });
          return;
        }
        setParsing((current) => new Set(current).add(draftId));
        const exit = yield* parseProductScan(apiBaseUrl, {
          recognizedText: draft.recognizedText,
          mode: draft.mode,
        }).pipe(
          Effect.tapError((error) =>
            error._tag === "ScanRateLimited"
              ? Effect.sync(() =>
                  setParse(draftId, { _tag: "RateLimited", retryAt: error.retryAt }),
                )
              : Effect.void,
          ),
          Effect.retry({
            schedule: rateLimitRetry,
            while: (error) => error._tag === "ScanRateLimited",
          }),
          Effect.map((result): ParseState => ({ _tag: "Parsed", result, parsedAt: Date.now() })),
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, environment.fetch),
          Effect.exit,
          Effect.ensuring(
            Effect.sync(() => {
              setPausedUntil(null);
              setParsing((current) => {
                const next = new Set(current);
                next.delete(draftId);
                return next;
              });
            }),
          ),
        );
        const latest = draftsRef.current.get(draftId);
        if (latest) setParse(draftId, parseStateAfter(exit, latest.parse));
      });

    const worker = Effect.runFork(
      Effect.forever(
        Queue.take(queue).pipe(
          Effect.flatMap(parseDraft),
          Effect.catchCause((cause) =>
            Effect.logError("Scan auto-fill stopped for a draft", cause),
          ),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(worker));
    };
  }, [queue, setParse]);

  React.useEffect(() => {
    if (!loaded || !online || fetch === null) return;
    const now = Date.now();
    for (const draft of draftsRef.current.values()) {
      if (draft.parse._tag !== "Failed" && eligibleForParse(draft, now)) requestParse(draft.id);
    }
  }, [loaded, online, fetch, requestParse]);

  const createDraft = React.useCallback(
    async (input: NewDraft): Promise<ScanDraft> => {
      const id = randomUUID();
      const now = Date.now();
      const photoUri =
        input.capturedPath === null
          ? null
          : await runStore(
              DraftStore.use((store) => store.adoptPhoto(id, input.capturedPath ?? "")),
            ).catch(() => null);
      const draft: ScanDraft = {
        id,
        mode: input.mode,
        photoUri,
        recognizedText: input.recognizedText,
        lines: input.lines,
        packs: 1,
        capturedAt: now,
        updatedAt: now,
        parse: input.recognizedText.trim() ? { _tag: "Waiting" } : { _tag: "Manual" },
      };
      writeDraft(draft);
      return draft;
    },
    [writeDraft],
  );

  const setPacks = React.useCallback(
    (draftId: string, packs: number) => {
      const draft = draftsRef.current.get(draftId);
      if (draft && packs >= 1) writeDraft({ ...draft, packs, updatedAt: Date.now() });
    },
    [writeDraft],
  );

  const saveEdits = React.useCallback(
    (draftId: string, edits: ReviewEdits) => {
      const draft = draftsRef.current.get(draftId);
      if (draft && !sameEdits(draft.edits, edits)) {
        writeDraft({ ...draft, edits, updatedAt: Date.now() });
      }
    },
    [writeDraft],
  );

  const removeDraft = React.useCallback(
    (draftId: string) => {
      commitDrafts((current) => {
        const next = new Map(current);
        next.delete(draftId);
        return next;
      });
      void runStore(DraftStore.use((store) => store.remove(draftId))).catch(() => undefined);
    },
    [commitDrafts],
  );

  React.useEffect(() => {
    if (lastCommit === null) return;
    const timer = setTimeout(() => setLastCommit(null), 3000);
    return () => clearTimeout(timer);
  }, [lastCommit]);

  const ordered = React.useMemo(
    () => [...drafts.values()].sort((left, right) => right.capturedAt - left.capturedAt),
    [drafts],
  );

  const value = React.useMemo<ScanDrafts>(
    () => ({
      drafts: ordered,
      loaded,
      parsing,
      pausedUntil,
      online,
      lastCommit,
      createDraft,
      requestParse,
      setPacks,
      setParse,
      saveEdits,
      removeDraft,
      noteCommit: setLastCommit,
    }),
    [
      ordered,
      loaded,
      parsing,
      pausedUntil,
      online,
      lastCommit,
      createDraft,
      requestParse,
      setPacks,
      setParse,
      saveEdits,
      removeDraft,
    ],
  );

  return <ScanDraftsContext value={value}>{children}</ScanDraftsContext>;
}

export function ScanDraftsProvider({ children }: { readonly children: React.ReactNode }) {
  const parent = React.use(ScanDraftsContext);
  if (parent !== null) return children;
  return <DraftsProvider>{children}</DraftsProvider>;
}

export const useScanDrafts = (): ScanDrafts => {
  const drafts = React.use(ScanDraftsContext);
  if (drafts === null) throw new Error("Scan drafts are only available inside ScanDraftsProvider.");
  return drafts;
};

export const useScanDraft = (draftId: string | undefined): ScanDraft | null => {
  const { drafts } = useScanDrafts();
  return drafts.find((draft) => draft.id === draftId) ?? null;
};
