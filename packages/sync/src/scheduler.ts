import type { SyncLiveWakeHint, SyncProtocolCode } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS } from "./replica/cadence";
import {
  classifySyncFailure,
  dispositionFor,
  type SyncFailureCause,
  type SyncFailureDisposition,
} from "./transport";

export type SyncWakeReason =
  | "startup"
  | "localWrite"
  | "focus"
  | "reconnect"
  | "timer"
  | "ownership"
  | "live";

type SyncWake = {
  readonly reason: SyncWakeReason;
  readonly hint?: SyncLiveWakeHint;
};

export type SyncCatchUpOutcome = "advanced" | "unchanged";

export type SyncSchedulerPolicy = {
  readonly activePollMillis: number;
  readonly backoffMillis: ReadonlyArray<number>;
  readonly hiddenPollMillis: number;
  readonly liveIdlePollMillis: number;
  readonly minPollMillis?: number;
  readonly maxRetryAfterMillis?: number;
  readonly digestVerificationIntervalMillis?: number;
  readonly pullMaxBytes?: number;
};

const DEFAULT_MAX_RETRY_AFTER_MILLIS = 5 * 60_000;

export const PULL_FLOOR_MILLIS = 60_000;

export const LIVE_IDLE_PULL_MILLIS = 15 * 60_000;

export const defaultHttpPollPolicy: SyncSchedulerPolicy = {
  activePollMillis: PULL_FLOOR_MILLIS,
  backoffMillis: [PULL_FLOOR_MILLIS, 2 * 60_000, 5 * 60_000],
  hiddenPollMillis: 5 * 60_000,
  liveIdlePollMillis: LIVE_IDLE_PULL_MILLIS,
  minPollMillis: PULL_FLOOR_MILLIS,
  maxRetryAfterMillis: DEFAULT_MAX_RETRY_AFTER_MILLIS,
  digestVerificationIntervalMillis: DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS,
};

export type SyncSchedulerStatus =
  | { readonly _tag: "running" }
  | { readonly _tag: "pausedForAuth"; readonly status: number }
  | {
      readonly _tag: "stopped";
      readonly status: number | undefined;
      readonly message: string;
    }
  | { readonly _tag: "storageError"; readonly message: string }
  | {
      readonly _tag: "recoveryRequired";
      readonly code: SyncProtocolCode;
      readonly message: string;
    };

export type SyncSchedulerContract = {
  readonly status: SubscriptionRef.SubscriptionRef<SyncSchedulerStatus>;
  readonly syncing: SubscriptionRef.SubscriptionRef<boolean>;
  readonly wake: (reason: SyncWakeReason, hint?: SyncLiveWakeHint) => Effect.Effect<void>;
  readonly setVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setNetworkOwner: (owner: boolean) => Effect.Effect<void>;
  readonly setLiveConnected: (connected: boolean) => Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
};

type SyncSchedulerHandlers = {
  readonly register?: () => Effect.Effect<void, SyncFailureCause>;
  readonly drainUpload: () => Effect.Effect<void, SyncFailureCause>;
  readonly catchUp: () => Effect.Effect<SyncCatchUpOutcome, SyncFailureCause>;
  readonly recover?: (code: SyncProtocolCode) => Effect.Effect<void, SyncFailureCause>;
  readonly hintApplied?: (hint: SyncLiveWakeHint) => Effect.Effect<boolean>;
};

type SchedulerVisibility = {
  readonly visible: boolean;
  readonly owner: boolean;
  readonly live: boolean;
};

const sleepJittered = (delay: Duration.Duration, floorMillis: number): Effect.Effect<void> =>
  Effect.void.pipe(
    Effect.schedule(
      Schedule.jittered(Schedule.duration(delay)).pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(
            Duration.max(
              Duration.millis(Math.round(Duration.toMillis(duration))),
              Duration.millis(floorMillis),
            ),
          ),
        ),
      ),
    ),
  );

const delayFor = (
  policy: SyncSchedulerPolicy,
  visibility: SchedulerVisibility,
  emptyPolls: number,
): Duration.Duration => {
  if (visibility.live) return Duration.millis(policy.liveIdlePollMillis);
  const base = visibility.visible ? policy.activePollMillis : policy.hiddenPollMillis;
  if (emptyPolls <= 0) return Duration.millis(base);
  const index = Math.min(emptyPolls - 1, policy.backoffMillis.length - 1);
  return Duration.millis(Math.max(base, policy.backoffMillis[index] ?? base));
};

const terminalStatus = (disposition: SyncFailureDisposition): SyncSchedulerStatus | undefined => {
  switch (disposition._tag) {
    case "pauseForAuth":
      return { _tag: "pausedForAuth", status: disposition.status };
    case "stop":
      return { _tag: "stopped", status: disposition.status, message: disposition.message };
    case "storageError":
      return { _tag: "storageError", message: disposition.message };
    case "recoveryRequired":
      return { _tag: "recoveryRequired", code: disposition.code, message: disposition.message };
    default:
      return undefined;
  }
};

const blocksUploadsOnly = (status: SyncSchedulerStatus): boolean =>
  status._tag === "recoveryRequired" && status.code === "REPLICA_SEQUENCE_GAP";

const isHalted = (status: SyncSchedulerStatus): boolean =>
  status._tag !== "running" && status._tag !== "pausedForAuth" && !blocksUploadsOnly(status);

const canDownload = (status: SyncSchedulerStatus): boolean =>
  status._tag === "running" || blocksUploadsOnly(status);

const isExplicitWake = (reason: SyncWakeReason): boolean =>
  reason === "localWrite" || reason === "focus" || reason === "reconnect" || reason === "live";

type QueuedWake = SyncWake | { readonly reason: "cadenceChanged" };

const timerWake: SyncWake = { reason: "timer" };

const cadenceChanged: QueuedWake = { reason: "cadenceChanged" };

const makeScheduler = <R>(
  handlers: SyncSchedulerHandlers,
  policy: SyncSchedulerPolicy,
  fork: (loop: Effect.Effect<never>) => Effect.Effect<Fiber.Fiber<never>, never, R>,
): Effect.Effect<SyncSchedulerContract, never, R> =>
  Effect.gen(function* () {
    const wakes = yield* Queue.unbounded<QueuedWake>();
    const visibility = yield* Ref.make<SchedulerVisibility>({
      visible: true,
      owner: false,
      live: false,
    });
    const emptyPolls = yield* Ref.make(0);
    const retryAfter = yield* Ref.make<number | undefined>(undefined);
    const status = yield* SubscriptionRef.make<SyncSchedulerStatus>({ _tag: "running" });
    const syncing = yield* SubscriptionRef.make(false);
    const maxRetryAfter = policy.maxRetryAfterMillis ?? DEFAULT_MAX_RETRY_AFTER_MILLIS;

    const backOff = Ref.update(emptyPolls, (n) => Math.min(n + 1, policy.backoffMillis.length));

    const handleFailure = (error: SyncFailureCause, allowRecovery: boolean): Effect.Effect<void> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const disposition = dispositionFor(classifySyncFailure(error, now));
        const halted = terminalStatus(disposition);
        if (halted !== undefined) {
          yield* SubscriptionRef.set(status, halted);
          return;
        }
        if (disposition._tag === "recover") {
          const recover = handlers.recover;
          if (recover === undefined || !allowRecovery) {
            yield* backOff;
            return;
          }
          yield* recover(disposition.code).pipe(
            Effect.matchEffect({
              onFailure: (cause) => handleFailure(cause, false),
              onSuccess: () => Ref.set(emptyPolls, 0),
            }),
          );
          return;
        }
        if (disposition._tag === "retry" && disposition.delayMillis !== undefined) {
          yield* Ref.set(retryAfter, Math.min(disposition.delayMillis, maxRetryAfter));
        }
        yield* backOff;
      });

    const onFailure = (error: SyncFailureCause) => handleFailure(error, true);

    const cycle = Effect.gen(function* () {
      const register = handlers.register;
      if (register !== undefined) {
        const registered = yield* register().pipe(
          Effect.matchEffect({
            onFailure: (error) => onFailure(error).pipe(Effect.as(false)),
            onSuccess: () => Effect.succeed(true),
          }),
        );
        if (!registered) return;
      }
      if (!blocksUploadsOnly(yield* SubscriptionRef.get(status))) {
        yield* handlers
          .drainUpload()
          .pipe(Effect.matchEffect({ onFailure, onSuccess: () => Effect.void }));
      }
      const afterUpload = yield* SubscriptionRef.get(status);
      if (!canDownload(afterUpload)) return;
      yield* handlers.catchUp().pipe(
        Effect.matchEffect({
          onFailure,
          onSuccess: (outcome) => (outcome === "advanced" ? Ref.set(emptyPolls, 0) : backOff),
        }),
      );
    });

    const runCycle = Effect.gen(function* () {
      const current = yield* Ref.get(visibility);
      if (!current.owner) return;
      yield* SubscriptionRef.set(syncing, true);
      yield* cycle.pipe(Effect.ensuring(SubscriptionRef.set(syncing, false)));
    });

    const awaitWork: Effect.Effect<ReadonlyArray<QueuedWake>> = Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(status);
      if (state._tag === "pausedForAuth") {
        const woken = yield* Queue.takeAll(wakes);
        if (woken.every((wake) => wake.reason === "cadenceChanged")) return [];
        yield* SubscriptionRef.set(status, { _tag: "running" });
        yield* Ref.set(emptyPolls, 0);
        return woken;
      }
      const override = yield* Ref.getAndSet(retryAfter, undefined);
      if (override !== undefined) {
        yield* Effect.sleep(Duration.millis(override));
        return [timerWake, ...(yield* Queue.clear(wakes))];
      }
      const delay = sleepJittered(
        delayFor(policy, yield* Ref.get(visibility), yield* Ref.get(emptyPolls)),
        policy.minPollMillis ?? 0,
      );
      return yield* Queue.takeAll(wakes).pipe(Effect.raceFirst(delay.pipe(Effect.as([timerWake]))));
    });

    const dueWake = (wake: QueuedWake): Effect.Effect<SyncWake | undefined> => {
      if (wake.reason === "cadenceChanged") return Effect.succeed(undefined);
      const hintApplied = handlers.hintApplied;
      if (wake.reason !== "live" || wake.hint === undefined || hintApplied === undefined) {
        return Effect.succeed(wake);
      }
      return Effect.map(hintApplied(wake.hint), (applied) => (applied ? undefined : wake));
    };

    const loop = Effect.forever(
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(status);
        if (isHalted(state)) return yield* Effect.interrupt;
        const woken = yield* awaitWork;
        const due = (yield* Effect.forEach(woken, dueWake)).filter(
          (wake): wake is SyncWake => wake !== undefined,
        );
        if (due.length === 0) return;
        if (due.some((wake) => isExplicitWake(wake.reason))) yield* Ref.set(emptyPolls, 0);
        yield* runCycle;
      }),
    );

    const updateCadence = (change: (current: SchedulerVisibility) => SchedulerVisibility) =>
      Ref.modify(visibility, (current) => {
        const next = change(current);
        return [next.visible !== current.visible || next.live !== current.live, next] as const;
      }).pipe(
        Effect.flatMap((changed) => (changed ? Queue.offer(wakes, cadenceChanged) : Effect.void)),
        Effect.asVoid,
      );
    const fiber = yield* fork(loop);

    return {
      status,
      syncing,
      wake: (reason, hint) =>
        Queue.offer(wakes, hint === undefined ? { reason } : { reason, hint }).pipe(Effect.asVoid),
      setVisible: (visible) => updateCadence((current) => ({ ...current, visible })),
      setNetworkOwner: (owner) =>
        Effect.gen(function* () {
          yield* Ref.update(visibility, (current) => ({ ...current, owner }));
          if (owner) yield* Queue.offer(wakes, { reason: "ownership" });
        }),
      setLiveConnected: (connected) =>
        updateCadence((current) => ({ ...current, live: connected })),
      shutdown: Fiber.interrupt(fiber).pipe(Effect.asVoid),
    } satisfies SyncSchedulerContract;
  });

export const makeSyncScheduler = (
  handlers: SyncSchedulerHandlers,
  policy: SyncSchedulerPolicy = defaultHttpPollPolicy,
): Effect.Effect<SyncSchedulerContract> => makeScheduler(handlers, policy, Effect.forkChild);

export class SyncScheduler extends Context.Service<SyncScheduler, SyncSchedulerContract>()(
  "@store/sync/SyncScheduler",
) {
  static readonly make = (
    handlers: SyncSchedulerHandlers,
    policy: SyncSchedulerPolicy = defaultHttpPollPolicy,
  ): Effect.Effect<SyncSchedulerContract, never, Scope.Scope> =>
    makeScheduler(handlers, policy, Effect.forkScoped);
}
