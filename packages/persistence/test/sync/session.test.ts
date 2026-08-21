import { SyncClientFrame, SyncLiveEvent, SyncRequest, SyncResponse } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { expect, test } from "vitest";

import { SyncTransportError } from "../../src/errors";
import {
  connectSyncSocketSession,
  makeSyncSocketSession,
  type SyncSocket,
} from "../../src/sync/session";

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

test("fails when the live socket is not connected", async () => {
  const error = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    return yield* session.exchange(request).pipe(Effect.flip);
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(error).toBeInstanceOf(SyncTransportError);
  expect(error.retryable).toBe(true);
  expect(error.message).toBe("Live synchronization disconnected.");
});

test("correlates an exchange-result frame on the live socket", async () => {
  const response = await Effect.gen(function* () {
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
    return yield* session.exchange(request);
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(response.nextCursor).toBe(0);
});

test("fails when a live exchange times out", async () => {
  const error = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
      exchangeTimeoutMillis: 10,
    });
    yield* waitForLive(session, messages);
    return yield* session.exchange(request).pipe(Effect.flip);
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(error).toBeInstanceOf(SyncTransportError);
  expect(error.retryable).toBe(true);
  expect(error.message).toBe("Live synchronization timed out.");
});

test("mints a fresh correlation token per exchange", async () => {
  const requestIds: string[] = [];
  await Effect.gen(function* () {
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
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(requestIds).toEqual(["1", "2"]);
});

test("hello and invalidate frames still surface as live pull signals", async () => {
  const events = await Effect.gen(function* () {
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
    return yield* session.events.pipe(Stream.take(2), Stream.runCollect);
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(events).toEqual([
    { type: "hello", protocolVersion: 2, headCursor: 9 },
    { type: "invalidate", protocolVersion: 2, headCursor: 12 },
  ]);
});

test("connect succeeds once the first hello arrives", async () => {
  await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    const connecting = yield* connectSyncSocketSession(session).pipe(Effect.forkChild);
    yield* Queue.offer(messages, helloFrame);
    yield* Fiber.join(connecting);
  }).pipe(Effect.scoped, Effect.runPromise);
});

test("connect fails when the live socket closes before hello", async () => {
  const error = await Effect.gen(function* () {
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
    return yield* connectSyncSocketSession(session, { connectTimeoutMillis: 1_000 }).pipe(
      Effect.flip,
    );
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(error).toBeInstanceOf(SyncTransportError);
  expect(error.retryable).toBe(true);
  expect(error.message).toBe("Live synchronization closed (1006).");
});

test("connect fails when hello never arrives before the timeout", async () => {
  const error = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
    });
    return yield* connectSyncSocketSession(session, { connectTimeoutMillis: 20 }).pipe(Effect.flip);
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(error).toBeInstanceOf(SyncTransportError);
  expect(error.retryable).toBe(true);
  expect(error.message).toBe("Live synchronization timed out waiting to become ready.");
});
