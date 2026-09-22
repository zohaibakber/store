import {
  LIVE_LONG_POLL_DEFAULT_MILLIS,
  LiveTicket,
  LiveTicketRequest,
  OPERATIONAL_SUBSCRIPTION,
  SyncLiveWakeHint,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/unstable/encoding/Sse";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import type { SyncScheduler } from "./scheduler";
import { SyncTransportUnavailable } from "./transport";
import type { SyncTransport } from "./transport";

export type LiveWakeHost = {
  readonly apiBaseUrl: string;
  readonly replicaId: string;
  readonly fetch: typeof globalThis.fetch;
  readonly preferSse: boolean;
};

const decodeWakeData = Schema.decodeUnknownOption(Schema.fromJsonString(SyncLiveWakeHint));

const liveUrl = (
  apiBaseUrl: string,
  ticket: LiveTicket,
  replicaId: string,
  afterHorizon: string | undefined,
  waitMs: number | undefined,
): string => {
  const root = apiBaseUrl.replace(/\/+$/u, "");
  const apiRoot = root.endsWith("/api") ? root : `${root}/api`;
  const live = new URL(`${apiRoot}/sync/live`);
  live.searchParams.set("nonce", ticket.nonce);
  live.searchParams.set("replicaId", replicaId);
  live.searchParams.set("subscription", ticket.subscription);
  if (afterHorizon !== undefined) live.searchParams.set("afterHorizon", afterHorizon);
  if (waitMs !== undefined) live.searchParams.set("waitMs", String(waitMs));
  return live.href;
};

const transportUnavailable = (message: string) => SyncTransportUnavailable.make({ message });

const asTransportUnavailable = (fallback: string) => (cause: unknown) =>
  cause instanceof SyncTransportUnavailable
    ? cause
    : transportUnavailable(cause instanceof Error ? cause.message : fallback);

const withHostFetch = <A, E, R>(
  host: LiveWakeHost,
  effect: Effect.Effect<A, E, R | HttpClient.HttpClient>,
) =>
  effect.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, host.fetch),
  );

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
        transportUnavailable(cause instanceof Error ? cause.message : "Live SSE read failed."),
    }),
  );

const longPollOnce = (
  host: LiveWakeHost,
  ticket: LiveTicket,
  afterHorizon: string | undefined,
): Effect.Effect<SyncLiveWakeHint | undefined> =>
  withHostFetch(
    host,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(
          liveUrl(
            host.apiBaseUrl,
            ticket,
            host.replicaId,
            afterHorizon,
            LIVE_LONG_POLL_DEFAULT_MILLIS,
          ),
        ).pipe(HttpClientRequest.acceptJson),
      );
      if (response.status === 204) return undefined;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          transportUnavailable(`Live long-poll failed with status ${response.status}.`),
        );
      }
      return yield* HttpClientResponse.schemaBodyJson(SyncLiveWakeHint)(response);
    }),
  ).pipe(
    Effect.mapError(asTransportUnavailable("Live long-poll failed.")),
    Effect.orElseSucceed(() => undefined),
  );

const openSseWakeStream = (
  host: LiveWakeHost,
  ticket: LiveTicket,
  afterHorizon: string | undefined,
): Effect.Effect<Stream.Stream<SyncLiveWakeHint> | undefined> =>
  withHostFetch(
    host,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client
        .execute(
          HttpClientRequest.get(
            liveUrl(host.apiBaseUrl, ticket, host.replicaId, afterHorizon, undefined),
          ).pipe(HttpClientRequest.accept("text/event-stream")),
        )
        .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
      return wakeHintsFromSseBytes(response.stream);
    }),
  ).pipe(
    Effect.mapError(asTransportUnavailable("Live SSE failed.")),
    Effect.orElseSucceed(() => undefined),
  );

export const runLiveWakeLoop = (
  transport: SyncTransport,
  host: LiveWakeHost,
  scheduler: SyncScheduler,
): Effect.Effect<void> => {
  let afterHorizon: string | undefined;

  const pass = Effect.gen(function* () {
    const ticket = yield* transport
      .mintLiveTicket({
        replicaId: host.replicaId,
        subscription: OPERATIONAL_SUBSCRIPTION,
      } satisfies LiveTicketRequest)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (ticket === undefined) {
      yield* scheduler.setLiveConnected(false);
      yield* Effect.sleep("30 seconds");
      return;
    }

    if (host.preferSse) {
      const stream = yield* openSseWakeStream(host, ticket, afterHorizon);
      if (stream === undefined) {
        yield* scheduler.setLiveConnected(false);
        yield* Effect.sleep("5 seconds");
        return;
      }
      yield* scheduler.setLiveConnected(true);
      yield* stream.pipe(
        Stream.runForEach((hint) =>
          Effect.gen(function* () {
            afterHorizon = hint.horizon;
            yield* scheduler.wake("live");
          }),
        ),
        Effect.ignore,
      );
      yield* scheduler.setLiveConnected(false);
      return;
    }

    const hint = yield* longPollOnce(host, ticket, afterHorizon);
    if (hint === undefined) {
      yield* scheduler.setLiveConnected(false);
      return;
    }
    yield* scheduler.setLiveConnected(true);
    afterHorizon = hint.horizon;
    yield* scheduler.wake("live");
  });

  return Effect.forever(pass).pipe(Effect.asVoid);
};

export const forkLiveWakeLoop = (
  transport: SyncTransport,
  host: LiveWakeHost,
  scheduler: SyncScheduler,
): Effect.Effect<Fiber.Fiber<void, never>> =>
  Effect.forkChild(runLiveWakeLoop(transport, host, scheduler).pipe(Effect.ignore, Effect.asVoid));
