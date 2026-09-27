import {
  LIVE_LONG_POLL_DEFAULT_MILLIS,
  LiveTicket,
  LiveTicketRequest,
  OPERATIONAL_SUBSCRIPTION,
  SyncLiveWakeHint,
} from "@store/contracts";
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
};

const decodeWakeData = Schema.decodeUnknownOption(Schema.fromJsonString(SyncLiveWakeHint));

const liveUrl = (
  host: LiveWakeHost,
  ticket: LiveTicket,
  afterHorizon: string | undefined,
  waitMs: number | undefined,
): string => {
  const root = host.apiBaseUrl.replace(/\/+$/u, "");
  const apiRoot = root.endsWith("/api") ? root : `${root}/api`;
  const live = new URL(`${apiRoot}/sync/live`);
  live.searchParams.set("nonce", ticket.nonce);
  live.searchParams.set("replicaId", host.replicaId);
  live.searchParams.set("subscription", ticket.subscription);
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

const longPollOnce = (
  client: HttpClient.HttpClient,
  host: LiveWakeHost,
  ticket: LiveTicket,
  afterHorizon: string | undefined,
): Effect.Effect<SyncLiveWakeHint | undefined> =>
  client
    .execute(
      HttpClientRequest.get(
        liveUrl(host, ticket, afterHorizon, LIVE_LONG_POLL_DEFAULT_MILLIS),
      ).pipe(HttpClientRequest.acceptJson),
    )
    .pipe(
      Effect.flatMap((response) =>
        response.status === 204 || response.status < 200 || response.status >= 300
          ? Effect.succeed(undefined)
          : HttpClientResponse.schemaBodyJson(SyncLiveWakeHint)(response),
      ),
      Effect.orElseSucceed(() => undefined),
    );

const openSseWakeStream = (
  client: HttpClient.HttpClient,
  host: LiveWakeHost,
  ticket: LiveTicket,
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
      Ref.set(afterHorizon, hint.horizon).pipe(Effect.andThen(scheduler.wake("live")));

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
        const stream = yield* openSseWakeStream(client, host, ticket, yield* Ref.get(afterHorizon));
        if (stream === undefined) {
          yield* scheduler.setLiveConnected(false);
          yield* Effect.sleep("5 seconds");
          return;
        }
        yield* scheduler.setLiveConnected(true);
        yield* stream.pipe(Stream.runForEach(wakeFrom), Effect.ignore);
        yield* scheduler.setLiveConnected(false);
        return;
      }

      const hint = yield* longPollOnce(client, host, ticket, yield* Ref.get(afterHorizon));
      if (hint === undefined) {
        yield* scheduler.setLiveConnected(false);
        return;
      }
      yield* scheduler.setLiveConnected(true);
      yield* wakeFrom(hint);
    });

    return yield* Effect.forever(pass);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, host.fetch),
  );
