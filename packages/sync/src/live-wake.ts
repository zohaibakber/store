import {
  LIVE_LONG_POLL_DEFAULT_MILLIS,
  LiveTicket,
  LiveTicketRequest,
  OPERATIONAL_SUBSCRIPTION,
  SyncLiveWakeHint,
} from "@store/contracts";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/unstable/encoding/Sse";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import type { SyncSchedulerContract } from "./scheduler";
import { SyncTransportOffline } from "./transport";
import type { SyncTransport } from "./transport";

export type LiveWakeHost = {
  readonly apiBaseUrl: string;
  readonly replicaId: string;
  readonly fetch: typeof globalThis.fetch;
  readonly preferSse: boolean;
  readonly credentials?: "bearer" | "ticket";
};

const LIVE_UNREACHABLE_RETRY: Duration.Input = "30 seconds";
const LIVE_SSE_REOPEN_RETRY: Duration.Input = "5 seconds";

const decodeWakeData = Schema.decodeUnknownOption(Schema.fromJsonString(SyncLiveWakeHint));

const liveUrl = (
  host: LiveWakeHost,
  ticket: LiveTicket | undefined,
  afterHorizon: string | undefined,
  waitMs: number | undefined,
): string => {
  const root = host.apiBaseUrl.replace(/\/+$/u, "");
  const apiRoot = root.endsWith("/api") ? root : `${root}/api`;
  const live = new URL(`${apiRoot}/sync/live`);
  if (ticket !== undefined) live.searchParams.set("nonce", ticket.nonce);
  live.searchParams.set("replicaId", host.replicaId);
  live.searchParams.set("subscription", ticket?.subscription ?? OPERATIONAL_SUBSCRIPTION);
  if (afterHorizon !== undefined) live.searchParams.set("afterHorizon", afterHorizon);
  if (waitMs !== undefined) live.searchParams.set("waitMs", String(waitMs));
  return live.href;
};

const transportOffline = (message: string) => SyncTransportOffline.make({ message });

const wakeHintsFromSseBytes = <E>(
  bytes: Stream.Stream<Uint8Array, E>,
): Stream.Stream<SyncLiveWakeHint> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.catchTag("Retry", () => Stream.empty),
    Stream.catchTag("SseError", () => Stream.empty),
    Stream.filter((event): event is Sse.Event => event._tag === "Event" && event.event === "wake"),
    Stream.map((event) => decodeWakeData(event.data)),
    Stream.filter(Option.isSome),
    Stream.map((hint) => hint.value),
    Stream.ignore,
  );

export const wakeHintsFromSseBody = (
  body: ReadableStream<Uint8Array>,
): Stream.Stream<SyncLiveWakeHint> =>
  wakeHintsFromSseBytes(
    Stream.fromReadableStream({
      evaluate: () => body,
      onError: (cause) =>
        transportOffline(cause instanceof Error ? cause.message : "Live SSE read failed."),
    }),
  );

type LongPollOutcome =
  | { readonly _tag: "wake"; readonly hint: SyncLiveWakeHint }
  | { readonly _tag: "idle" }
  | { readonly _tag: "failed" };

const LONG_POLL_IDLE: LongPollOutcome = { _tag: "idle" };
const LONG_POLL_FAILED: LongPollOutcome = { _tag: "failed" };

const longPollOnce = (
  client: HttpClient.HttpClient,
  host: LiveWakeHost,
  ticket: LiveTicket | undefined,
  afterHorizon: string | undefined,
): Effect.Effect<LongPollOutcome> =>
  client
    .execute(
      HttpClientRequest.get(
        liveUrl(host, ticket, afterHorizon, LIVE_LONG_POLL_DEFAULT_MILLIS),
      ).pipe(HttpClientRequest.acceptJson),
    )
    .pipe(
      Effect.flatMap((response) => {
        if (response.status === 204) return Effect.succeed(LONG_POLL_IDLE);
        if (response.status < 200 || response.status >= 300) {
          return Effect.succeed(LONG_POLL_FAILED);
        }
        return HttpClientResponse.schemaBodyJson(SyncLiveWakeHint)(response).pipe(
          Effect.map((hint): LongPollOutcome => ({ _tag: "wake", hint })),
        );
      }),
      Effect.orElseSucceed(() => LONG_POLL_FAILED),
    );

const openSseWakeStream = (
  client: HttpClient.HttpClient,
  host: LiveWakeHost,
  ticket: LiveTicket | undefined,
  afterHorizon: string | undefined,
): Effect.Effect<Stream.Stream<SyncLiveWakeHint> | undefined> =>
  client
    .execute(
      HttpClientRequest.get(liveUrl(host, ticket, afterHorizon, undefined)).pipe(
        HttpClientRequest.accept("text/event-stream"),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.map((response) => wakeHintsFromSseBytes(response.stream)),
      Effect.orElseSucceed(() => undefined),
    );

export const runLiveWakeLoop = (
  transport: SyncTransport,
  host: LiveWakeHost,
  scheduler: SyncSchedulerContract,
): Effect.Effect<never> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const afterHorizon = yield* Ref.make<string | undefined>(undefined);
    const wakeFrom = (hint: SyncLiveWakeHint) =>
      Ref.set(afterHorizon, hint.horizon).pipe(Effect.andThen(scheduler.wake("live", hint)));

    const disconnected = (retryAfter: Duration.Input) =>
      scheduler.setLiveConnected(false).pipe(Effect.andThen(Effect.sleep(retryAfter)));

    const pass = Effect.gen(function* () {
      const ticketed = host.credentials === "ticket";
      const ticket = ticketed
        ? yield* transport
            .mintLiveTicket({
              replicaId: host.replicaId,
              subscription: OPERATIONAL_SUBSCRIPTION,
            } satisfies LiveTicketRequest)
            .pipe(Effect.orElseSucceed(() => undefined))
        : undefined;
      if (ticketed && ticket === undefined) {
        return yield* disconnected(LIVE_UNREACHABLE_RETRY);
      }

      if (host.preferSse) {
        const stream = yield* openSseWakeStream(client, host, ticket, yield* Ref.get(afterHorizon));
        if (stream === undefined) {
          return yield* disconnected(ticketed ? LIVE_SSE_REOPEN_RETRY : LIVE_UNREACHABLE_RETRY);
        }
        yield* scheduler.setLiveConnected(true);
        yield* stream.pipe(Stream.runForEach(wakeFrom), Effect.ignore);
        yield* scheduler.setLiveConnected(false);
        return;
      }

      const outcome = yield* longPollOnce(client, host, ticket, yield* Ref.get(afterHorizon));
      switch (outcome._tag) {
        case "wake":
          yield* scheduler.setLiveConnected(true);
          return yield* wakeFrom(outcome.hint);
        case "idle":
          return yield* scheduler.setLiveConnected(true);
        case "failed":
          return yield* ticketed
            ? scheduler.setLiveConnected(false)
            : disconnected(LIVE_UNREACHABLE_RETRY);
      }
    });

    return yield* Effect.forever(pass);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, host.fetch),
  );
