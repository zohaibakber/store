import { assert, it } from "@effect/vitest";
import type { SyncStatus } from "@store/contracts";
import { SyncLiveEvent } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeSyncClientRuntime } from "../src/runtime";

class TestSyncError extends Schema.TaggedError<TestSyncError>()("TestSyncError", {
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

const status: SyncStatus = {
  phase: "starting",
  configured: true,
  lastSyncedAt: null,
  message: "Starting",
  pendingOperations: 0,
  oldestPendingAt: null,
  lastError: null,
  quarantined: false,
};

it.effect("coalesces invalidations into one active pass and one pending rerun", () =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<SyncLiveEvent>();
    const calls = yield* Ref.make(0);
    const active = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const rerun = yield* Deferred.make<void>();

    const runtime = yield* makeSyncClientRuntime({
      initialStatus: status,
      adapter: {
        exchangeOnce: Effect.gen(function* () {
          const call = yield* Ref.updateAndGet(calls, (count) => count + 1);
          if (call === 2) {
            yield* Deferred.succeed(active, undefined);
            yield* Deferred.await(release);
          }
          if (call === 3) yield* Deferred.succeed(rerun, undefined);
          return { cursor: 10, hasMore: false, moreLocalWork: false };
        }),
        completedStatus: Effect.succeed({
          ...status,
          phase: "idle",
          lastSyncedAt: 1,
          message: "Synced",
        }),
        failureStatus: (error) =>
          Effect.succeed({ ...status, phase: "error", message: error.message }),
        retryable: (error) => error.retryable,
        tooManyRounds: () => TestSyncError.make({ message: "too many rounds", retryable: false }),
      },
      live: { events: Stream.fromQueue(events) },
      safetyPollIntervalMillis: 60_000,
    });

    yield* runtime.start;
    yield* Queue.offer(
      events,
      SyncLiveEvent.make({ type: "hello", protocolVersion: 2, headCursor: 10 }),
    );
    yield* Deferred.await(active);
    yield* Effect.forEach(
      Array.from({ length: 10 }),
      () =>
        Queue.offer(
          events,
          SyncLiveEvent.make({ type: "invalidate", protocolVersion: 2, headCursor: 10 }),
        ),
      { discard: true },
    );
    yield* Deferred.succeed(release, undefined);
    yield* Deferred.await(rerun);
    yield* Effect.yieldNow;
    assert.strictEqual(yield* Ref.get(calls), 3);
  }),
);

it.effect("drains until the last observed live head is durably reached", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const reached = yield* Deferred.make<void>();
    const runtime = yield* makeSyncClientRuntime<TestSyncError, never>({
      initialStatus: status,
      adapter: {
        exchangeOnce: Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.tap((call) => (call === 3 ? Deferred.succeed(reached, undefined) : Effect.void)),
          Effect.map((call) => ({
            cursor: call === 1 ? 0 : call === 2 ? 2 : 5,
            hasMore: false,
            moreLocalWork: false,
          })),
        ),
        completedStatus: Effect.succeed({ ...status, phase: "idle", message: "Synced" }),
        failureStatus: (error) =>
          Effect.succeed({ ...status, phase: "error", message: error.message }),
        retryable: (error) => error.retryable,
        tooManyRounds: () => TestSyncError.make({ message: "too many rounds", retryable: false }),
      },
      live: {
        events: Stream.make(
          SyncLiveEvent.make({ type: "hello", protocolVersion: 2, headCursor: 5 }),
        ).pipe(Stream.concat(Stream.never)),
      },
      safetyPollIntervalMillis: 60_000,
    });
    yield* runtime.start;
    yield* Deferred.await(reached);
    assert.strictEqual(yield* Ref.get(calls), 3);
  }),
);
