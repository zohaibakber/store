import type { SyncStatus } from "@store/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { RuntimeOptions, SyncReason } from "./model";

export interface SyncClientRuntime<E> {
  readonly start: Effect.Effect<void>;
  readonly requestSync: (reason: SyncReason) => Effect.Effect<SyncStatus, E>;
  readonly signal: (reason: SyncReason) => Effect.Effect<void>;
  readonly status: Effect.Effect<SyncStatus>;
  readonly statusChanges: Stream.Stream<SyncStatus>;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const makeSyncClientRuntime = <E, LiveE>(options: RuntimeOptions<E, LiveE>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const status = yield* SubscriptionRef.make(options.initialStatus);
    const signals = yield* Queue.sliding<SyncReason>(1);
    const lock = yield* Semaphore.make(1);
    const started = yield* Ref.make(false);
    const liveConnected = yield* Ref.make(false);
    const observedHead = yield* Ref.make(0);
    const maximumRounds = options.maximumExchangeRounds ?? 100;

    const publishPhase = (phase: SyncStatus["phase"], message: string) =>
      SubscriptionRef.update(status, (current) => ({ ...current, phase, message }));

    const requestSync: SyncClientRuntime<E>["requestSync"] = Effect.fn(
      "SyncClientRuntime.requestSync",
    )(function* (_reason: SyncReason) {
      return yield* lock
        .withPermit(
          Effect.gen(function* () {
            yield* publishPhase("syncing", "Synchronizing local and cloud changes…");
            let rounds = 0;
            let progress = yield* options.adapter.exchangeOnce.pipe(
              Effect.retry({
                schedule: Schedule.exponential(
                  Duration.millis(options.exchangeRetryBaseMillis ?? 500),
                ).pipe(Schedule.jittered),
                times: 3,
                while: options.adapter.retryable,
              }),
            );
            rounds += 1;
            let target = yield* Ref.get(observedHead);
            while (
              (progress.hasMore || progress.moreLocalWork || progress.cursor < target) &&
              rounds < maximumRounds
            ) {
              progress = yield* options.adapter.exchangeOnce.pipe(
                Effect.retry({
                  schedule: Schedule.exponential(
                    Duration.millis(options.exchangeRetryBaseMillis ?? 500),
                  ).pipe(Schedule.jittered),
                  times: 3,
                  while: options.adapter.retryable,
                }),
              );
              rounds += 1;
              target = yield* Ref.get(observedHead);
            }
            if (progress.hasMore || progress.moreLocalWork || progress.cursor < target)
              return yield* Effect.fail(options.adapter.tooManyRounds(maximumRounds));

            const completed = yield* options.adapter.completedStatus;
            const connected = yield* Ref.get(liveConnected);
            const next: SyncStatus = {
              ...completed,
              phase: connected ? "live" : completed.phase,
              message: connected ? "Local and cloud data are live" : completed.message,
            };
            yield* SubscriptionRef.set(status, next);
            return next;
          }),
        )
        .pipe(
          Effect.tapError((error) =>
            options.adapter
              .failureStatus(error)
              .pipe(Effect.flatMap((next) => SubscriptionRef.set(status, next))),
          ),
        );
    });

    const signal = Effect.fn("SyncClientRuntime.signal")((reason: SyncReason) =>
      Queue.offer(signals, reason).pipe(Effect.asVoid),
    );

    const signalConsumer = Stream.fromQueue(signals).pipe(
      Stream.runForEach((reason) =>
        requestSync(reason).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("SyncClientRuntime.background_sync_failed").pipe(
              Effect.annotateLogs({ reason, error: messageOf(error) }),
            ),
          ),
          Effect.ignore,
        ),
      ),
    );

    const live = options.live;
    const startLive = live
      ? Effect.gen(function* () {
          const retrySchedule = Schedule.exponential(
            Duration.millis(options.liveRetryBaseMillis ?? 500),
          ).pipe(
            Schedule.jittered,
            Schedule.modifyDelay(({ duration }) =>
              Effect.succeed(
                Duration.min(duration, Duration.millis(options.liveRetryCapMillis ?? 30_000)),
              ),
            ),
          );
          const consume = Effect.gen(function* () {
            yield* Ref.set(liveConnected, false);
            yield* publishPhase("connecting", "Connecting live synchronization…");
            yield* live.events.pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  yield* Ref.set(liveConnected, true);
                  yield* Ref.update(observedHead, (cursor) => Math.max(cursor, event.headCursor));
                  // A hello always pulls, even when its head equals our cursor.
                  yield* signal("live");
                }),
              ),
            );
          }).pipe(
            Effect.tapError((error) =>
              Ref.set(liveConnected, false).pipe(
                Effect.andThen(
                  publishPhase("offline", "Live synchronization disconnected; retrying…"),
                ),
                Effect.andThen(
                  Effect.logWarning("SyncClientRuntime.live_disconnected").pipe(
                    Effect.annotateLogs({ error: messageOf(error) }),
                  ),
                ),
              ),
            ),
          );
          yield* consume.pipe(Effect.retry(retrySchedule), Effect.forkIn(scope));
        })
      : Effect.void;

    const start = Effect.fn("SyncClientRuntime.start")(function* () {
      if (yield* Ref.getAndSet(started, true)) return;
      yield* signalConsumer.pipe(Effect.forkIn(scope));
      yield* requestSync("startup").pipe(Effect.ignore);
      yield* startLive;
      const interval = options.safetyPollIntervalMillis ?? 300_000;
      yield* signal("safety-poll").pipe(
        Effect.delay(interval),
        Effect.repeat(Schedule.spaced(interval)),
        Effect.forkIn(scope),
      );
    });

    return {
      start: start(),
      requestSync,
      signal,
      status: SubscriptionRef.get(status),
      statusChanges: SubscriptionRef.changes(status),
    } satisfies SyncClientRuntime<E>;
  });
