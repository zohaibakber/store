import { assert, it } from "@effect/vitest";
import { SyncClientFrame, SyncLiveEvent, SyncRequest, SyncResponse } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { SyncTransportError } from "../src/errors";
import { connectSyncSocketSession, makeSyncSocketSession, type SyncSocket } from "../src/session";

const request: SyncRequest = {
  protocolVersion: 2,
  organizationId: "org-1",
  deviceId: "device-1",
  cursor: 0,
  operations: [],
};

const responseFor = (value: SyncRequest): SyncResponse => ({
  protocolVersion: 2,
  organizationId: value.organizationId,
  cursor: value.cursor,
  nextCursor: value.cursor,
  headCursor: value.cursor,
  hasMore: false,
  acknowledgements: [],
  changes: [],
});

const queuedSocket = (
  messages: Queue.Queue<string>,
  onSend?: (payload: string) => Effect.Effect<void, SyncTransportError>,
): SyncSocket => ({
  send: (payload) => onSend?.(payload) ?? Effect.void,
  messages: Stream.fromQueue(messages),
});

const helloFrame = JSON.stringify(
  SyncLiveEvent.make({ type: "hello", protocolVersion: 2, headCursor: 0 }),
);

const waitForLive = (
  session: { readonly events: Stream.Stream<SyncLiveEvent, SyncTransportError> },
  messages: Queue.Queue<string>,
) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    yield* session.events.pipe(
      Stream.tap(() => Deferred.succeed(ready, undefined).pipe(Effect.asVoid)),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* Queue.offer(messages, helloFrame);
    yield* Deferred.await(ready);
  });

it.effect("fails when the live socket is not connected", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    const error = yield* session.exchange(request).pipe(Effect.flip);
    assert.instanceOf(error, SyncTransportError);
    assert.strictEqual(error.retryable, true);
    assert.strictEqual(error.message, "Live synchronization disconnected.");
  }),
);

it.effect("correlates an exchange-result frame on the live socket", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(
        queuedSocket(messages, (payload) => {
          const frame = Schema.decodeUnknownOption(SyncClientFrame)(JSON.parse(payload));
          if (Option.isNone(frame) || frame.value.type !== "exchange") return Effect.void;
          return Queue.offer(
            messages,
            JSON.stringify({
              type: "exchange-result",
              requestId: frame.value.requestId,
              response: responseFor(frame.value.request),
            }),
          );
        }),
      ),
    });
    yield* waitForLive(session, messages);
    const response = yield* session.exchange(request);
    assert.strictEqual(response.nextCursor, 0);
  }),
);

it.effect("fails when a live exchange times out", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
      exchangeTimeoutMillis: 1_000,
    });
    yield* waitForLive(session, messages);
    const fiber = yield* session.exchange(request).pipe(Effect.flip, Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("1 second");
    const error = yield* Fiber.join(fiber);
    assert.instanceOf(error, SyncTransportError);
    assert.strictEqual(error.retryable, true);
    assert.strictEqual(error.message, "Live synchronization timed out.");
  }),
);

it.effect("mints a fresh correlation token per exchange", () =>
  Effect.gen(function* () {
    const requestIds: string[] = [];
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(
        queuedSocket(messages, (payload) => {
          const frame = Schema.decodeUnknownOption(SyncClientFrame)(JSON.parse(payload));
          if (Option.isNone(frame) || frame.value.type !== "exchange") return Effect.void;
          requestIds.push(frame.value.requestId);
          return Queue.offer(
            messages,
            JSON.stringify({
              type: "exchange-result",
              requestId: frame.value.requestId,
              response: responseFor(frame.value.request),
            }),
          );
        }),
      ),
    });
    yield* waitForLive(session, messages);
    yield* session.exchange(request);
    yield* session.exchange(request);
    assert.deepStrictEqual(requestIds, ["1", "2"]);
  }),
);

it.effect("hello and invalidate frames still surface as live pull signals", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    yield* Queue.offer(
      messages,
      JSON.stringify(SyncLiveEvent.make({ type: "hello", protocolVersion: 2, headCursor: 9 })),
    );
    yield* Queue.offer(
      messages,
      JSON.stringify(
        SyncLiveEvent.make({ type: "invalidate", protocolVersion: 2, headCursor: 12 }),
      ),
    );
    const events = yield* session.events.pipe(Stream.take(2), Stream.runCollect);
    assert.deepStrictEqual(Array.from(events), [
      { type: "hello", protocolVersion: 2, headCursor: 9 },
      { type: "invalidate", protocolVersion: 2, headCursor: 12 },
    ]);
  }),
);

it.effect("connect succeeds once the first hello arrives", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    const connecting = yield* connectSyncSocketSession(session).pipe(Effect.forkChild);
    yield* Queue.offer(messages, helloFrame);
    yield* Fiber.join(connecting);
  }),
);

it.effect("connect fails when the live socket closes before hello", () =>
  Effect.gen(function* () {
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed({
        send: () => Effect.void,
        messages: Stream.fail(
          SyncTransportError.make({
            message: "Live synchronization closed (1006).",
            retryable: true,
          }),
        ),
      }),
    });
    const error = yield* connectSyncSocketSession(session, { connectTimeoutMillis: 1_000 }).pipe(
      Effect.flip,
    );
    assert.instanceOf(error, SyncTransportError);
    assert.strictEqual(error.retryable, true);
    assert.strictEqual(error.message, "Live synchronization closed (1006).");
  }),
);

it.effect("connect fails when hello never arrives before the timeout", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    const fiber = yield* connectSyncSocketSession(session, { connectTimeoutMillis: 1_000 }).pipe(
      Effect.flip,
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    yield* TestClock.adjust("1 second");
    const error = yield* Fiber.join(fiber);
    assert.instanceOf(error, SyncTransportError);
    assert.strictEqual(error.retryable, true);
    assert.strictEqual(error.message, "Live synchronization timed out waiting to become ready.");
  }),
);

it.effect("removes a pending exchange when sending fails", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const sendError = SyncTransportError.make({ message: "send failed", retryable: true });
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(
        queuedSocket(messages, (payload) => {
          const frame = Schema.decodeUnknownOption(SyncClientFrame)(JSON.parse(payload));
          return Option.isSome(frame) && frame.value.type === "exchange"
            ? Effect.fail(sendError)
            : Effect.void;
        }),
      ),
    });
    yield* waitForLive(session, messages);

    const error = yield* session.exchange(request).pipe(Effect.flip);

    assert.strictEqual(error, sendError);
  }),
);

it.effect("sends pings at one interval rather than double-spacing them", () =>
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const pings = yield* Queue.unbounded<void>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(
        queuedSocket(messages, (payload) => {
          const frame = Schema.decodeUnknownOption(SyncClientFrame)(JSON.parse(payload));
          return Option.isSome(frame) && frame.value.type === "ping"
            ? Queue.offer(pings, undefined)
            : Effect.void;
        }),
      ),
      pingIntervalMillis: 1_000,
    });
    yield* waitForLive(session, messages);

    yield* TestClock.adjust("1 second");
    yield* Queue.take(pings);
    yield* TestClock.adjust("1 second");
    yield* Queue.take(pings);
    yield* TestClock.adjust("1 second");
    yield* Queue.take(pings);
  }),
);
