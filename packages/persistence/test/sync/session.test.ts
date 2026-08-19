import { SyncClientFrame, SyncLiveEvent, SyncRequest, SyncResponse } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { expect, test } from "vitest";

import { SyncTransportError } from "../../src/errors";
import { makeSyncSocketSession, type SyncSocket } from "../../src/sync/session";

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
  onSend?: (payload: string) => Effect.Effect<void>,
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

test("exchanges over HTTP when the live socket is not connected", async () => {
  const result = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    let httpCalls = 0;
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
      httpExchange: (value) => {
        httpCalls += 1;
        return Effect.succeed(responseFor(value));
      },
    });
    const response = yield* session.exchange(request);
    return { response, httpCalls };
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(result.httpCalls).toBe(1);
  expect(result.response.organizationId).toBe("org-1");
});

test("correlates an exchange-result frame on the live socket", async () => {
  const result = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    let httpCalls = 0;
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
      httpExchange: (value) => {
        httpCalls += 1;
        return Effect.succeed(responseFor(value));
      },
    });
    yield* waitForLive(session, messages);
    const response = yield* session.exchange(request);
    return { response, httpCalls };
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(result.httpCalls).toBe(0);
  expect(result.response.nextCursor).toBe(0);
});

test("falls back to HTTP when a live exchange times out", async () => {
  const result = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    let httpCalls = 0;
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
      httpExchange: (value) => {
        httpCalls += 1;
        return Effect.succeed(responseFor(value));
      },
      exchangeTimeoutMillis: 10,
    });
    yield* waitForLive(session, messages);
    const response = yield* session.exchange(request);
    return { response, httpCalls };
  }).pipe(Effect.scoped, Effect.runPromise);

  expect(result.httpCalls).toBe(1);
  expect(result.response.organizationId).toBe("org-1");
});

test("hello and invalidate frames still surface as live pull signals", async () => {
  const events = await Effect.gen(function* () {
    const messages = yield* Queue.unbounded<string>();
    const session = yield* makeSyncSocketSession({
      open: Effect.succeed(queuedSocket(messages)),
      httpExchange: (value) => Effect.succeed(responseFor(value)),
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
