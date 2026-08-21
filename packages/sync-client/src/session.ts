import {
  SyncClientFrame,
  SyncLiveEvent,
  SyncRequest,
  SyncResponse,
  SyncServerFrame,
} from "@store/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Filter from "effect/Filter";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { SyncTransportError } from "./errors";

export interface SyncSocket {
  readonly send: (payload: string) => Effect.Effect<void, SyncTransportError>;
  readonly messages: Stream.Stream<string, SyncTransportError>;
}

export interface SyncSocketSession {
  readonly events: Stream.Stream<SyncLiveEvent, SyncTransportError>;
  readonly exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>;
}

export interface LiveSocketHandle {
  readonly send: (payload: string) => void;
  readonly close: (code?: number, reason?: string) => void;
  readonly listen: (handlers: {
    readonly message: (payload: string) => void;
    readonly error: (cause: unknown) => void;
    readonly close: (code: number, reason: string) => void;
  }) => () => void;
}

const encodeClientFrame = Schema.encodeSync(SyncClientFrame);
const decodeServerFrame = Schema.decodeUnknownOption(SyncServerFrame);

const disconnected = () =>
  SyncTransportError.make({
    message: "Live synchronization disconnected.",
    retryable: true,
  });

const transportFailure = (message: string, cause?: unknown) =>
  SyncTransportError.make({
    message,
    retryable: true,
    cause,
  });

export const syncSocketFromHandle = (handle: LiveSocketHandle): SyncSocket => {
  const pending: string[] = [];
  let sink:
    | {
        readonly offer: (value: string) => void;
        readonly fail: (error: SyncTransportError) => void;
      }
    | undefined;
  let terminal: SyncTransportError | undefined;
  const fail = (error: SyncTransportError) => {
    if (sink) sink.fail(error);
    else terminal = error;
  };
  const stop = handle.listen({
    message: (payload) => {
      if (sink) sink.offer(payload);
      else pending.push(payload);
    },
    error: (cause) =>
      fail(
        transportFailure(
          cause instanceof Error ? cause.message : "Live synchronization failed.",
          cause,
        ),
      ),
    close: (code, reason) =>
      fail(
        transportFailure(`Live synchronization closed (${code}${reason ? `: ${reason}` : ""}).`),
      ),
  });

  return {
    send: (payload) =>
      Effect.try({
        try: () => handle.send(payload),
        catch: (cause) =>
          transportFailure(
            cause instanceof Error ? cause.message : "Live synchronization could not send.",
            cause,
          ),
      }),
    messages: Stream.callback<string, SyncTransportError>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          sink = {
            offer: (value) => Queue.offerUnsafe(queue, value),
            fail: (error) => Queue.failCauseUnsafe(queue, Cause.fail(error)),
          };
          for (const payload of pending) Queue.offerUnsafe(queue, payload);
          pending.length = 0;
          if (terminal) Queue.failCauseUnsafe(queue, Cause.fail(terminal));
          return stop;
        }),
        (stopListening) =>
          Effect.sync(() => {
            sink = undefined;
            stopListening();
            handle.close(1000, "Live socket released");
          }),
      ),
    ),
  };
};

export const syncSocketFromWebSocket = (socket: WebSocket): SyncSocket =>
  syncSocketFromHandle({
    send: (payload) => socket.send(payload),
    close: (code, reason) => socket.close(code, reason),
    listen: (handlers) => {
      const onMessage = (event: MessageEvent) => handlers.message(String(event.data));
      const onError = (event: Event) => handlers.error(event);
      const onClose = (event: CloseEvent) => handlers.close(event.code, event.reason);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
      return () => {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
    },
  });

export const makeSyncSocketSession = Effect.fn("SyncSocketSession.make")(function* (input: {
  readonly open: Effect.Effect<SyncSocket, SyncTransportError>;
  readonly exchangeTimeoutMillis?: number;
  readonly pingIntervalMillis?: number;
}) {
  const socketRef = yield* Ref.make<SyncSocket | null>(null);
  const pendingRef = yield* Ref.make(
    HashMap.empty<string, Deferred.Deferred<SyncResponse, SyncTransportError>>(),
  );
  // Correlation tokens for in-flight frames. Unique among this session's
  // requests; the server echoes them and keys nothing by them. A counter
  // stays valid on Hermes, which has no Web Crypto global.
  let issued = 0;
  const nextRequestId = () => String((issued += 1));

  const failPending = (error: SyncTransportError) =>
    Ref.get(pendingRef).pipe(
      Effect.flatMap((pending) =>
        Effect.forEach(HashMap.values(pending), (deferred) => Deferred.fail(deferred, error), {
          discard: true,
        }),
      ),
      Effect.andThen(Ref.set(pendingRef, HashMap.empty())),
    );

  const dropPending = (requestId: string) =>
    Ref.update(pendingRef, (pending) => HashMap.remove(pending, requestId));

  const handleFrame = (raw: string) =>
    Effect.gen(function* () {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (cause) {
        return yield* Effect.fail(
          SyncTransportError.make({
            message: "The live sync server sent malformed JSON.",
            retryable: true,
            code: "INVALID_LIVE_EVENT",
            cause,
          }),
        );
      }
      const frame = decodeServerFrame(parsed);
      if (Option.isNone(frame))
        return yield* Effect.fail(
          SyncTransportError.make({
            message: "The live sync server sent an invalid event.",
            retryable: true,
            code: "INVALID_LIVE_EVENT",
          }),
        );
      const value = frame.value;
      if (value.type === "hello" || value.type === "invalidate") return value;
      if (value.type === "pong") return undefined;
      const pending = yield* Ref.get(pendingRef);
      const deferred = HashMap.get(pending, value.requestId);
      if (Option.isNone(deferred)) return undefined;
      yield* dropPending(value.requestId);
      if (value.type === "exchange-result") yield* Deferred.succeed(deferred.value, value.response);
      else
        yield* Deferred.fail(
          deferred.value,
          SyncTransportError.make({
            message: value.message,
            retryable: value.retryable,
            code: value.code,
          }),
        );
      return undefined;
    });

  const events = Stream.unwrap(
    Effect.gen(function* () {
      const socket = yield* input.open;
      yield* Ref.set(socketRef, socket);
      yield* Effect.addFinalizer(() =>
        Ref.set(socketRef, null).pipe(Effect.andThen(failPending(disconnected()))),
      );
      const pingInterval = input.pingIntervalMillis ?? 240_000;
      const ping = Effect.gen(function* () {
        const current = yield* Ref.get(socketRef);
        if (!current) return;
        yield* current
          .send(JSON.stringify(encodeClientFrame({ type: "ping", requestId: nextRequestId() })))
          .pipe(Effect.ignore);
      });
      yield* ping.pipe(
        Effect.delay(Duration.millis(pingInterval)),
        Effect.repeat(Schedule.spaced(Duration.millis(pingInterval))),
        Effect.forkScoped,
      );
      return socket.messages.pipe(
        Stream.mapEffect(handleFrame),
        Stream.filterMap(
          Filter.fromPredicate((event): event is SyncLiveEvent => event !== undefined),
        ),
      );
    }),
  );

  const exchange = Effect.fn("SyncSocketSession.exchange")(function* (request: SyncRequest) {
    const socket = yield* Ref.get(socketRef);
    if (!socket) return yield* Effect.fail(disconnected());
    const requestId = nextRequestId();
    const deferred = yield* Deferred.make<SyncResponse, SyncTransportError>();
    yield* Ref.update(pendingRef, (pending) => HashMap.set(pending, requestId, deferred));
    yield* socket
      .send(JSON.stringify(encodeClientFrame({ type: "exchange", requestId, request })))
      .pipe(Effect.tapError(() => dropPending(requestId)));
    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(input.exchangeTimeoutMillis ?? 45_000),
        orElse: () =>
          dropPending(requestId).pipe(
            Effect.andThen(
              Effect.fail(
                SyncTransportError.make({
                  message: "Live synchronization timed out.",
                  retryable: true,
                }),
              ),
            ),
          ),
      }),
    );
  });

  return { events, exchange } satisfies SyncSocketSession;
});

const DEFAULT_CONNECT_TIMEOUT_MILLIS = 15_000;

/**
 * Opens the live event stream and waits until the first `hello` or
 * `invalidate`. Socket close/error, an empty stream end, or silence past
 * `connectTimeoutMillis` fail instead of hanging forever.
 */
export const connectSyncSocketSession = Effect.fn("SyncSocketSession.connect")(function* (
  session: SyncSocketSession,
  options?: { readonly connectTimeoutMillis?: number },
) {
  const ready = yield* Deferred.make<void, SyncTransportError>();
  yield* session.events.pipe(
    Stream.tap(() => Deferred.succeed(ready, undefined).pipe(Effect.asVoid)),
    Stream.runDrain,
    Effect.tapError((error) => Deferred.fail(ready, error).pipe(Effect.ignore)),
    Effect.tap(() =>
      Deferred.fail(
        ready,
        SyncTransportError.make({
          message: "Live synchronization closed before it became ready.",
          retryable: true,
        }),
      ).pipe(Effect.ignore),
    ),
    Effect.forkScoped,
  );
  yield* Deferred.await(ready).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(options?.connectTimeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MILLIS),
      orElse: () =>
        Effect.fail(
          SyncTransportError.make({
            message: "Live synchronization timed out waiting to become ready.",
            retryable: true,
          }),
        ),
    }),
  );
  return session;
});
