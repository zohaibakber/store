import type { SyncStatus } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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
    const liveStarted = yield* Ref.make(false);
    const liveConnected = yield* Ref.make(false);
    const liveReady = yield* Deferred.make<void>();
    const observedHead = yield* Ref.make(0);
    const pendingWake = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);
    const maximumRounds = options.maximumExchangeRounds ?? 100;
    const liveConnectTimeoutMillis = options.liveConnectTimeoutMillis ?? 15_000;

    const publishPhase = (phase: SyncStatus["phase"], message: string) =>
      SubscriptionRef.update(status, (current) => ({ ...current, phase, message }));

    const signal = Effect.fn("SyncClientRuntime.signal")((reason: SyncReason) =>
      Queue.offer(signals, reason).pipe(Effect.asVoid),
    );

    const scheduleFailureWake = (delayMillis: number) =>
      Effect.gen(function* () {
        const previous = yield* Ref.getAndSet(pendingWake, null);
        if (previous) yield* Fiber.interrupt(previous).pipe(Effect.ignore);
        const fiber = yield* signal("safety-poll").pipe(
          Effect.delay(Duration.millis(delayMillis)),
          Effect.forkIn(scope),
        );
        yield* Ref.set(pendingWake, fiber);
      });

    const cancelFailureWake = Ref.getAndSet(pendingWake, null).pipe(
      Effect.flatMap((previous) =>
        previous ? Fiber.interrupt(previous).pipe(Effect.ignore) : Effect.void,
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
                  yield* Deferred.succeed(liveReady, undefined).pipe(Effect.ignore);
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

    /** Open the live socket on first sync — not during store layer acquire / start(). */
    const ensureLive = live
      ? Effect.gen(function* () {
          if (!(yield* Ref.getAndSet(liveStarted, true))) yield* startLive;
          yield* Deferred.await(liveReady).pipe(
            Effect.timeout(Duration.millis(liveConnectTimeoutMillis)),
            Effect.ignore,
          );
        })
      : Effect.void;

    const exchangePass = (reason: SyncReason) =>
      options.adapter.exchangeOnce(reason).pipe(
        Effect.retry({
          schedule: Schedule.exponential(
            Duration.millis(options.exchangeRetryBaseMillis ?? 500),
          ).pipe(Schedule.jittered),
          times: 3,
          while: options.adapter.retryable,
        }),
      );

    const requestSync: SyncClientRuntime<E>["requestSync"] = Effect.fn(
      "SyncClientRuntime.requestSync",
    )(function* (reason: SyncReason) {
      yield* ensureLive;
      return yield* lock
        .withPermit(
          Effect.gen(function* () {
            yield* publishPhase("syncing", "Synchronizing local and cloud changes…");
            let rounds = 0;
            let progress = yield* exchangePass(reason);
            rounds += 1;
            let target = yield* Ref.get(observedHead);
            while (
              (progress.hasMore || progress.moreLocalWork || progress.cursor < target) &&
              rounds < maximumRounds
            ) {
              progress = yield* exchangePass(reason);
              rounds += 1;
              target = yield* Ref.get(observedHead);
            }
            if (progress.hasMore || progress.moreLocalWork || progress.cursor < target)
              return yield* Effect.fail(options.adapter.tooManyRounds(maximumRounds));

            yield* cancelFailureWake;
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
            options.adapter.failureStatus(error).pipe(
              Effect.flatMap((next) => SubscriptionRef.set(status, next)),
              Effect.andThen(
                options.adapter.retryAfterFailureMillis
                  ? options.adapter
                      .retryAfterFailureMillis(error)
                      .pipe(
                        Effect.flatMap((delay) =>
                          delay === null ? Effect.void : scheduleFailureWake(delay),
                        ),
                      )
                  : Effect.void,
              ),
            ),
          ),
        );
    });

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

    const start = Effect.fn("SyncClientRuntime.start")(function* () {
      if (yield* Ref.getAndSet(started, true)) return;
      yield* signalConsumer.pipe(Effect.forkIn(scope));
      // Live WS opens on first requestSync/signal, not here — keeps OfflineStore
      // construction off the Network timeline until sync is actually requested.
      if (!live) yield* requestSync("startup").pipe(Effect.ignore);
      const interval = options.safetyPollIntervalMillis ?? 3_000;
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
