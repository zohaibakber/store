import type { SyncProtocolCode } from "@store/contracts";
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

import { DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS } from "./replica/digest-cadence";
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

export type SyncSchedulerPolicy = {
  readonly activePollMillis: number;
  readonly backoffMillis: ReadonlyArray<number>;
  readonly hiddenPollMillis: number;
  readonly liveIdlePollMillis: number;
  readonly maxRetryAfterMillis?: number;
  readonly digestVerificationIntervalMillis?: number;
};

const DEFAULT_MAX_RETRY_AFTER_MILLIS = 5 * 60_000;

export const defaultHttpPollPolicy: SyncSchedulerPolicy = {
  activePollMillis: 2_000,
  backoffMillis: [5_000, 15_000, 30_000],
  hiddenPollMillis: 60_000,
  liveIdlePollMillis: 5 * 60_000,
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
  readonly wake: (reason: SyncWakeReason) => Effect.Effect<void>;
  readonly setVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setNetworkOwner: (owner: boolean) => Effect.Effect<void>;
  readonly setLiveConnected: (connected: boolean) => Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
};

export type SyncSchedulerHandlers = {
  readonly register?: () => Effect.Effect<void, SyncFailureCause>;
  readonly drainUpload: () => Effect.Effect<void, SyncFailureCause>;
  readonly catchUp: () => Effect.Effect<void, SyncFailureCause>;
  readonly recover?: (code: SyncProtocolCode) => Effect.Effect<void, SyncFailureCause>;
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

const makeScheduler = <R>(
  handlers: SyncSchedulerHandlers,
  policy: SyncSchedulerPolicy,
  fork: (loop: Effect.Effect<never>) => Effect.Effect<Fiber.Fiber<never>, never, R>,
): Effect.Effect<SyncSchedulerContract, never, R> =>
  Effect.gen(function* () {
    const wakes = yield* Queue.unbounded<SyncWakeReason>();
    const visibility = yield* Ref.make<SchedulerVisibility>({
      visible: true,
      owner: false,
      live: false,
    });
    const emptyPolls = yield* Ref.make(0);
    const retryAfter = yield* Ref.make<number | undefined>(undefined);
    const status = yield* SubscriptionRef.make<SyncSchedulerStatus>({ _tag: "running" });
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

    const runCycle = Effect.gen(function* () {
      const current = yield* Ref.get(visibility);
      if (!current.owner) return;
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
          onSuccess: () => Ref.set(emptyPolls, 0),
        }),
      );
    });

    const awaitWork = Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(status);
      if (state._tag === "pausedForAuth") {
        const reason = yield* Queue.take(wakes);
        yield* SubscriptionRef.set(status, { _tag: "running" });
        yield* Ref.set(emptyPolls, 0);
        return reason;
      }
      const override = yield* Ref.getAndSet(retryAfter, undefined);
      const delay =
        override === undefined
          ? sleepJittered(delayFor(policy, yield* Ref.get(visibility), yield* Ref.get(emptyPolls)))
          : Effect.sleep(Duration.millis(override));
      return yield* Queue.take(wakes).pipe(
        Effect.raceFirst(delay.pipe(Effect.as("timer" as const))),
      );
    });

    const loop = Effect.forever(
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(status);
        if (isHalted(state)) return yield* Effect.interrupt;
        const reason = yield* awaitWork;
        if (isExplicitWake(reason)) yield* Ref.set(emptyPolls, 0);
        yield* runCycle;
      }),
    );
    const fiber = yield* fork(loop);

    return {
      status,
      wake: (reason) => Queue.offer(wakes, reason).pipe(Effect.asVoid),
      setVisible: (visible) => Ref.update(visibility, (current) => ({ ...current, visible })),
      setNetworkOwner: (owner) =>
        Effect.gen(function* () {
          yield* Ref.update(visibility, (current) => ({ ...current, owner }));
          if (owner) yield* Queue.offer(wakes, "ownership");
        }),
      setLiveConnected: (connected) =>
        Ref.update(visibility, (current) => ({ ...current, live: connected })),
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
