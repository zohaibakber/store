import type { SyncLiveWakeHint } from "@store/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { makeBackoff, type Backoff } from "./backoff";
import {
  DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS,
  type DigestVerificationCadence,
} from "./replica/cadence";
import {
  initialSessionState,
  step,
  type Cadence,
  type SessionCommand,
  type SessionEvent,
  type SessionState,
  type SessionStep,
  type StepOutcome,
  type SyncWakeReason,
} from "./session-state";
import { restingPhase, type SyncPhase, type SyncState } from "./sync-state";
import {
  classifySyncFailure,
  dispositionFor,
  type RecoverableCode,
  type SyncFailureCause,
} from "./transport";

export type { SyncWakeReason } from "./session-state";

export type SyncCatchUpOutcome = "advanced" | "unchanged";

export type SyncSchedulerPolicy = {
  readonly activePollMillis: number;
  readonly backoffMaxMillis?: number;
  readonly hiddenPollMillis: number;
  readonly liveIdlePollMillis: number;
  readonly minPollMillis?: number;
  readonly maxRetryAfterMillis?: number;
  readonly digestVerificationIntervalMillis?: DigestVerificationCadence;
  readonly pullMaxBytes?: number;
};

const DEFAULT_MAX_RETRY_AFTER_MILLIS = 5 * 60_000;

const DEFAULT_BACKOFF_MAX_MILLIS = 5 * 60_000;

const PULL_FLOOR_MILLIS = 60_000;

const LIVE_IDLE_PULL_MILLIS = 15 * 60_000;

export const defaultHttpPollPolicy: SyncSchedulerPolicy = {
  activePollMillis: PULL_FLOOR_MILLIS,
  backoffMaxMillis: DEFAULT_BACKOFF_MAX_MILLIS,
  hiddenPollMillis: 5 * 60_000,
  liveIdlePollMillis: LIVE_IDLE_PULL_MILLIS,
  minPollMillis: PULL_FLOOR_MILLIS,
  maxRetryAfterMillis: DEFAULT_MAX_RETRY_AFTER_MILLIS,
  digestVerificationIntervalMillis: DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS,
};

export type SyncSchedulerContract = {
  readonly state: SubscriptionRef.SubscriptionRef<SyncState>;
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
  readonly recover?: (code: RecoverableCode) => Effect.Effect<void, SyncFailureCause>;
  readonly hintApplied?: (hint: SyncLiveWakeHint) => Effect.Effect<boolean>;
};

type Incoming = { readonly event: SessionEvent; readonly run?: number };

type RunCommand = Extract<SessionCommand, { readonly _tag: "run" }>;

const PHASE_OF_STEP = {
  register: "registering",
  upload: "uploading",
  catchUp: "catchingUp",
  recover: "recovering",
} as const satisfies Record<SessionStep, SyncPhase>;

const TIMER: Incoming = { event: { _tag: "timer" } };

const projectSession =
  (before: SessionState, after: SessionState) =>
  (current: SyncState): SyncState => {
    const { suspended: shown, ...rest } = current;
    const running = after.running;
    const phase =
      running === undefined
        ? restingPhase(current.cursor)
        : before.running?.step === running.step
          ? current.phase
          : PHASE_OF_STEP[running.step];
    const base = { ...rest, phase, live: after.live, owner: after.owner };
    if (after.suspended === undefined) return base;
    const { reason, message } = after.suspended;
    return {
      ...base,
      suspended: shown?.retryAt === undefined ? { reason, message } : { ...shown, reason, message },
    };
  };

const withRetryAt =
  (retryAt: number | undefined) =>
  (current: SyncState): SyncState => {
    if (current.suspended === undefined || current.suspended.retryAt === retryAt) return current;
    const { reason, message } = current.suspended;
    return {
      ...current,
      suspended: retryAt === undefined ? { reason, message } : { reason, message, retryAt },
    };
  };

const makeCadences = (policy: SyncSchedulerPolicy) => {
  const backoffMaxMillis = policy.backoffMaxMillis ?? DEFAULT_BACKOFF_MAX_MILLIS;
  const floorMillis = policy.minPollMillis ?? 0;
  const growing = (baseMillis: number) =>
    makeBackoff({ baseMillis, maxMillis: Math.max(baseMillis, backoffMaxMillis), floorMillis });
  const constant = (baseMillis: number) =>
    makeBackoff({ baseMillis, maxMillis: baseMillis, floorMillis });
  return Effect.all({
    active: growing(policy.activePollMillis),
    hidden: growing(policy.hiddenPollMillis),
    live: constant(policy.liveIdlePollMillis),
    slow: constant(policy.hiddenPollMillis),
  }) satisfies Effect.Effect<Record<Cadence, Backoff>>;
};

const makeScheduler = (
  handlers: SyncSchedulerHandlers,
  policy: SyncSchedulerPolicy,
  state: SubscriptionRef.SubscriptionRef<SyncState>,
): Effect.Effect<SyncSchedulerContract, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<Incoming>();
    const session = yield* Ref.make(initialSessionState);
    const currentRun = yield* Ref.make(0);
    const fibers = yield* FiberMap.make<"step" | "timer", void, never>();
    const cadences = yield* makeCadences(policy);
    const reduce = step({
      canRecover: handlers.recover !== undefined,
      maxRetryAfterMillis: policy.maxRetryAfterMillis ?? DEFAULT_MAX_RETRY_AFTER_MILLIS,
    });

    const offer = (incoming: Incoming) => Queue.offer(events, incoming).pipe(Effect.asVoid);

    const supervised = <A>(effect: Effect.Effect<A>, fallback: A): Effect.Effect<A> =>
      Effect.catchCauseIf(
        effect,
        (cause) => !Cause.hasInterrupts(cause),
        (cause) => Effect.logError("sync.session_defect", cause).pipe(Effect.as(fallback)),
      );

    const hintApplied = (hint: SyncLiveWakeHint): Effect.Effect<boolean> =>
      handlers.hintApplied === undefined
        ? Effect.succeed(false)
        : supervised(handlers.hintApplied(hint), false);

    const handlerFor = (command: RunCommand): Effect.Effect<boolean, SyncFailureCause> => {
      switch (command.step) {
        case "register":
          return handlers.register === undefined
            ? Effect.succeed(false)
            : Effect.as(handlers.register(), false);
        case "upload":
          return Effect.as(handlers.drainUpload(), false);
        case "catchUp":
          return Effect.map(handlers.catchUp(), (outcome) => outcome === "advanced");
        case "recover":
          return handlers.recover === undefined || command.code === undefined
            ? Effect.succeed(false)
            : Effect.as(handlers.recover(command.code), false);
      }
    };

    const failedOutcome = Effect.fn("SyncScheduler.failedOutcome")(function* (
      stepName: SessionStep,
      cause: Cause.Cause<SyncFailureCause>,
    ) {
      const error = Cause.findErrorOption(cause);
      if (Option.isNone(error)) {
        yield* Effect.logError("sync.step_defect", cause).pipe(
          Effect.annotateLogs({ step: stepName }),
        );
        return {
          _tag: "failed",
          disposition: { _tag: "retry", delayMillis: undefined },
        } satisfies StepOutcome;
      }
      const failure = classifySyncFailure(error.value, yield* Clock.currentTimeMillis);
      const disposition = dispositionFor(failure);
      if (disposition._tag === "suspend" || (disposition._tag === "retry" && disposition.suspect)) {
        yield* Effect.logWarning("sync.step_failed").pipe(
          Effect.annotateLogs({ step: stepName, failure: failure._tag, message: failure.message }),
        );
      }
      return { _tag: "failed", disposition } satisfies StepOutcome;
    });

    const runStep = Effect.fn("SyncScheduler.runStep")(function* (command: RunCommand) {
      const run = yield* Ref.updateAndGet(currentRun, (n) => n + 1);
      const reported = handlerFor(command).pipe(
        Effect.matchCauseEffect({
          onSuccess: (advanced): Effect.Effect<StepOutcome> =>
            Effect.succeed({ _tag: "done", advanced }),
          onFailure: (cause) => failedOutcome(command.step, cause),
        }),
        Effect.flatMap((outcome) =>
          offer({ run, event: { _tag: "stepEnded", step: command.step, outcome } }),
        ),
      );
      yield* FiberMap.run(fibers, "step", reported);
    });

    const cancelSleep = FiberMap.remove(fibers, "timer").pipe(
      Effect.andThen(SubscriptionRef.update(state, withRetryAt(undefined))),
    );

    const arm = Effect.fn("SyncScheduler.arm")(function* (delay: Duration.Duration) {
      if (!Duration.isFinite(delay)) return yield* cancelSleep;
      yield* FiberMap.run(fibers, "timer", Effect.sleep(delay).pipe(Effect.andThen(offer(TIMER))));
      const retryAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(delay);
      yield* SubscriptionRef.update(state, withRetryAt(retryAt));
    });

    const resetCadences = Effect.forEach(Object.values(cadences), (cadence) => cadence.reset, {
      discard: true,
    });

    const recheck = Effect.fn("SyncScheduler.recheck")(function* (hint: SyncLiveWakeHint) {
      if (!(yield* hintApplied(hint)))
        yield* offer({ event: { _tag: "wake", reason: "live", hint } });
    });

    const execute = (command: SessionCommand): Effect.Effect<void> => {
      switch (command._tag) {
        case "run":
          return runStep(command);
        case "interrupt":
          return Ref.update(currentRun, (n) => n + 1).pipe(
            Effect.andThen(FiberMap.remove(fibers, "step")),
          );
        case "sleep":
          return (command.reset ? resetCadences : Effect.void).pipe(
            Effect.andThen(cadences[command.cadence].next),
            Effect.flatMap(arm),
          );
        case "sleepFor":
          return arm(Duration.millis(command.millis));
        case "cancelSleep":
          return cancelSleep;
        case "recheck":
          return recheck(command.hint);
      }
    };

    const isStale = Effect.fn("SyncScheduler.isStale")(function* ({ event, run }: Incoming) {
      if (run !== undefined) return run !== (yield* Ref.get(currentRun));
      if (event._tag !== "wake" || event.reason !== "live" || event.hint === undefined)
        return false;
      return yield* hintApplied(event.hint);
    });

    const handle = Effect.fn("SyncScheduler.handle")(function* (incoming: Incoming) {
      if (yield* isStale(incoming)) return;
      const before = yield* Ref.get(session);
      const [after, commands] = reduce(before, incoming.event);
      yield* Ref.set(session, after);
      yield* SubscriptionRef.update(state, projectSession(before, after));
      if (incoming.event._tag === "timer") {
        yield* SubscriptionRef.update(state, withRetryAt(undefined));
      }
      yield* Effect.forEach(commands, (command) => supervised(execute(command), undefined), {
        discard: true,
      });
    });

    const loop = Effect.forever(
      Queue.take(events).pipe(
        Effect.flatMap((incoming) => supervised(handle(incoming), undefined)),
      ),
    );
    const fiber = yield* Effect.forkScoped(loop);

    return {
      state,
      wake: (reason, hint) =>
        offer({
          event: hint === undefined ? { _tag: "wake", reason } : { _tag: "wake", reason, hint },
        }),
      setVisible: (visible) => offer({ event: { _tag: "visible", visible } }),
      setNetworkOwner: (owned) => offer({ event: { _tag: "owner", owned } }),
      setLiveConnected: (connected) => offer({ event: { _tag: "live", connected } }),
      shutdown: Fiber.interrupt(fiber).pipe(Effect.andThen(FiberMap.clear(fibers))),
    } satisfies SyncSchedulerContract;
  });

export class SyncScheduler extends Context.Service<SyncScheduler, SyncSchedulerContract>()(
  "@store/sync/SyncScheduler",
) {
  static readonly make = makeScheduler;
}
