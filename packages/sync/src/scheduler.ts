import * as Array from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Order from "effect/Order";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

export type SyncWakeReason =
  | "startup"
  | "localWrite"
  | "focus"
  | "reconnect"
  | "timer"
  | "ownership"
  | "live";

export type SyncSchedulerPolicy = {
  readonly activePollMillis: number;
  readonly backoffMillis: ReadonlyArray<number>;
  readonly hiddenPollMillis: number;
  readonly liveIdlePollMillis: number;
};

export const defaultHttpPollPolicy: SyncSchedulerPolicy = {
  activePollMillis: 2_000,
  backoffMillis: [5_000, 15_000, 30_000],
  hiddenPollMillis: 60_000,
  liveIdlePollMillis: 5 * 60_000,
};

export type SyncScheduler = {
  readonly wake: (reason: SyncWakeReason) => Effect.Effect<void>;
  readonly setVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setNetworkOwner: (owner: boolean) => Effect.Effect<void>;
  readonly setLiveConnected: (connected: boolean) => Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
};

export type SyncSchedulerHandlers = {
  readonly drainUpload: () => Effect.Effect<void, unknown>;
  readonly catchUp: () => Effect.Effect<void, unknown>;
};

type SchedulerVisibility = {
  readonly visible: boolean;
  readonly owner: boolean;
  readonly live: boolean;
};

const sleepJittered = (delay: Duration.Duration): Effect.Effect<void> =>
  Effect.void.pipe(Effect.schedule(Schedule.jittered(Schedule.duration(delay))));

const delayFor = (
  policy: SyncSchedulerPolicy,
  visibility: SchedulerVisibility,
  emptyPolls: number,
): Duration.Duration => {
  if (visibility.live) return Duration.millis(policy.liveIdlePollMillis);
  if (!visibility.visible) return Duration.millis(policy.hiddenPollMillis);
  if (emptyPolls <= 0) return Duration.millis(policy.activePollMillis);
  const index = Math.min(emptyPolls - 1, policy.backoffMillis.length - 1);
  return Duration.millis(policy.backoffMillis[index] ?? policy.hiddenPollMillis);
};

export const makeSyncScheduler = (
  handlers: SyncSchedulerHandlers,
  policy: SyncSchedulerPolicy = defaultHttpPollPolicy,
): Effect.Effect<SyncScheduler> =>
  Effect.gen(function* () {
    const wakes = yield* Queue.unbounded<SyncWakeReason>();
    const visibility = yield* Ref.make<SchedulerVisibility>({
      visible: true,
      owner: false,
      live: false,
    });
    const emptyPolls = yield* Ref.make(0);

    const runCycle = Effect.gen(function* () {
      const current = yield* Ref.get(visibility);
      if (!current.owner) return;
      yield* handlers.drainUpload().pipe(Effect.ignore);
      yield* handlers.catchUp().pipe(
        Effect.matchEffect({
          onFailure: () =>
            Ref.update(emptyPolls, (n) => Math.min(n + 1, policy.backoffMillis.length)),
          onSuccess: () => Ref.set(emptyPolls, 0),
        }),
      );
    });

    const fiber = yield* Effect.forever(
      Effect.gen(function* () {
        const delay = delayFor(policy, yield* Ref.get(visibility), yield* Ref.get(emptyPolls));
        const reason = yield* Queue.take(wakes).pipe(
          Effect.raceFirst(sleepJittered(delay).pipe(Effect.as("timer" as const))),
        );
        if (
          reason === "localWrite" ||
          reason === "focus" ||
          reason === "reconnect" ||
          reason === "live"
        ) {
          yield* Ref.set(emptyPolls, 0);
        }
        yield* runCycle;
      }),
    ).pipe(Effect.forkChild);

    return {
      wake: (reason) => Queue.offer(wakes, reason).pipe(Effect.asVoid),
      setVisible: (visible) =>
        Ref.update(visibility, (current) => ({ ...current, visible })).pipe(Effect.asVoid),
      setNetworkOwner: (owner) =>
        Effect.gen(function* () {
          yield* Ref.update(visibility, (current) => ({ ...current, owner }));
          if (owner) yield* Queue.offer(wakes, "ownership");
        }).pipe(Effect.asVoid),
      setLiveConnected: (connected) =>
        Ref.update(visibility, (current) => ({ ...current, live: connected })).pipe(Effect.asVoid),
      shutdown: Fiber.interrupt(fiber).pipe(Effect.asVoid),
    } satisfies SyncScheduler;
  });

export const coalesceCommitNotices = <A extends { readonly localCommitVersion: number }>(
  notices: Stream.Stream<A>,
): Stream.Stream<A> =>
  notices.pipe(
    Stream.groupedWithin(64, "16 millis"),
    Stream.filter(Array.isArrayNonEmpty),
    Stream.map((batch) =>
      Array.max(
        batch,
        Order.mapInput(Order.Number, (notice: A) => notice.localCommitVersion),
      ),
    ),
  );
