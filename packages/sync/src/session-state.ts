import { compareDecimalSequence, type SyncLiveWakeHint } from "@store/contracts";

import type { Suspension } from "./sync-state";
import type { RecoverableCode, SyncFailureDisposition } from "./transport";

export type SyncWakeReason =
  | "startup"
  | "localWrite"
  | "focus"
  | "reconnect"
  | "timer"
  | "ownership"
  | "live";

export type SessionStep = "register" | "upload" | "catchUp" | "recover";

type CycleStep = Exclude<SessionStep, "recover">;

export type StepOutcome =
  | { readonly _tag: "done"; readonly advanced: boolean }
  | { readonly _tag: "failed"; readonly disposition: SyncFailureDisposition };

export type SessionEvent =
  | { readonly _tag: "wake"; readonly reason: SyncWakeReason; readonly hint?: SyncLiveWakeHint }
  | { readonly _tag: "owner"; readonly owned: boolean }
  | { readonly _tag: "visible"; readonly visible: boolean }
  | { readonly _tag: "live"; readonly connected: boolean }
  | { readonly _tag: "stepEnded"; readonly step: SessionStep; readonly outcome: StepOutcome }
  | { readonly _tag: "timer" };

export type Cadence = "active" | "hidden" | "live" | "slow";

export type SessionCommand =
  | { readonly _tag: "run"; readonly step: SessionStep; readonly code?: RecoverableCode }
  | { readonly _tag: "interrupt" }
  | { readonly _tag: "sleep"; readonly cadence: Cadence; readonly reset: boolean }
  | { readonly _tag: "sleepFor"; readonly millis: number }
  | { readonly _tag: "cancelSleep" }
  | { readonly _tag: "recheck"; readonly hint: SyncLiveWakeHint };

type RunningStep = {
  readonly step: SessionStep;
  readonly origin?: CycleStep;
  readonly uploads: boolean;
  readonly failed: boolean;
  readonly advanced: boolean;
  readonly slow: boolean;
};

type ParkedWakes = {
  readonly explicit: boolean;
  readonly plain: boolean;
  readonly hint: SyncLiveWakeHint | undefined;
};

export type SessionState = {
  readonly owner: boolean;
  readonly visible: boolean;
  readonly live: boolean;
  readonly running: RunningStep | undefined;
  readonly parked: ParkedWakes | undefined;
  readonly cooling: boolean;
  readonly fresh: boolean;
  readonly retryAfterMillis: number | undefined;
  readonly suspects: number;
  readonly suspended: Suspension | undefined;
};

export type SessionPolicy = {
  readonly maxRetryAfterMillis: number;
  readonly canRecover: boolean;
};

export type SessionTransition = readonly [SessionState, ReadonlyArray<SessionCommand>];

export const SUSPECT_LIMIT = 3;

export const initialSessionState: SessionState = {
  owner: false,
  visible: true,
  live: false,
  running: undefined,
  parked: undefined,
  cooling: false,
  fresh: false,
  retryAfterMillis: undefined,
  suspects: 0,
  suspended: undefined,
};

type WakeClass = "explicit" | "live" | "timer";

const wakeClass = (reason: SyncWakeReason): WakeClass => {
  switch (reason) {
    case "startup":
    case "ownership":
    case "localWrite":
    case "focus":
    case "reconnect":
      return "explicit";
    case "live":
      return "live";
    case "timer":
      return "timer";
  }
};

const NONE: ReadonlyArray<SessionCommand> = [];

const CANCEL_SLEEP: SessionCommand = { _tag: "cancelSleep" };

const INTERRUPT: SessionCommand = { _tag: "interrupt" };

const mayStart = (suspended: Suspension | undefined, wake: WakeClass): boolean =>
  suspended === undefined ||
  suspended.blocks !== "all" ||
  wake === "explicit" ||
  (wake === "timer" && suspended.timer);

const cadenceOf = (state: SessionState): Cadence =>
  state.live ? "live" : state.visible ? "active" : "hidden";

const higherHint = (
  held: SyncLiveWakeHint | undefined,
  offered: SyncLiveWakeHint | undefined,
): SyncLiveWakeHint | undefined => {
  if (held === undefined) return offered;
  if (offered === undefined) return held;
  return compareDecimalSequence(offered.horizon, held.horizon) > 0 ? offered : held;
};

const startCycle = (state: SessionState, explicit: boolean): SessionTransition => [
  {
    ...state,
    parked: undefined,
    running: {
      step: "register",
      uploads: explicit || state.suspended?.blocks !== "uploads",
      failed: false,
      advanced: false,
      slow: false,
    },
  },
  [{ _tag: "run", step: "register" }],
];

const runNext = (state: SessionState, running: RunningStep, next: CycleStep): SessionTransition => [
  {
    ...state,
    running: {
      step: next,
      uploads: running.uploads,
      failed: running.failed,
      advanced: running.advanced,
      slow: running.slow,
    },
  },
  [{ _tag: "run", step: next }],
];

const finishCycle = (state: SessionState, running: RunningStep): SessionTransition => {
  const clean = !running.failed;
  const suspended =
    clean && state.suspended !== undefined && (state.suspended.blocks === "all" || running.uploads)
      ? undefined
      : state.suspended;
  const parked = state.parked;
  const settled: SessionState = {
    ...state,
    running: undefined,
    parked: undefined,
    suspects: clean ? 0 : state.suspects,
    suspended,
  };
  if (
    parked !== undefined &&
    (parked.explicit || parked.plain) &&
    settled.retryAfterMillis === undefined &&
    mayStart(suspended, parked.explicit ? "explicit" : "live")
  ) {
    return startCycle(settled, parked.explicit);
  }
  const recheck: ReadonlyArray<SessionCommand> =
    parked?.hint === undefined ? NONE : [{ _tag: "recheck", hint: parked.hint }];
  if (settled.retryAfterMillis !== undefined) {
    return [
      { ...settled, cooling: true, retryAfterMillis: undefined },
      [...recheck, { _tag: "sleepFor", millis: settled.retryAfterMillis }],
    ];
  }
  if (suspended !== undefined && suspended.blocks === "all" && !suspended.timer) {
    return [settled, recheck];
  }
  const cadence: Cadence =
    (suspended !== undefined && suspended.blocks === "all") || running.slow
      ? "slow"
      : cadenceOf(settled);
  return [
    { ...settled, fresh: false },
    [...recheck, { _tag: "sleep", cadence, reset: settled.fresh || running.advanced }],
  ];
};

const afterFailure = (
  state: SessionState,
  running: RunningStep,
  origin: CycleStep,
): SessionTransition =>
  origin === "upload" && state.suspended?.blocks !== "all"
    ? runNext(state, running, "catchUp")
    : finishCycle(state, running);

const onWake = (
  state: SessionState,
  reason: SyncWakeReason,
  hint: SyncLiveWakeHint | undefined,
): SessionTransition => {
  const wake = wakeClass(reason);
  const explicit = wake === "explicit";
  if (!state.owner || (state.running === undefined && state.cooling)) {
    return [explicit && !state.fresh ? { ...state, fresh: true } : state, NONE];
  }
  const fresh = state.fresh || wake !== "timer";
  if (state.running !== undefined) {
    return [
      {
        ...state,
        fresh,
        parked: {
          explicit: (state.parked?.explicit ?? false) || explicit,
          plain: (state.parked?.plain ?? false) || hint === undefined,
          hint: higherHint(state.parked?.hint, hint),
        },
      },
      NONE,
    ];
  }
  if (!mayStart(state.suspended, wake)) return [state, NONE];
  const [next, commands] = startCycle({ ...state, fresh }, explicit);
  return [next, [CANCEL_SLEEP, ...commands]];
};

const onOwner = (state: SessionState, owned: boolean): SessionTransition => {
  if (owned === state.owner) return [state, NONE];
  if (owned) return onWake({ ...state, owner: true }, "ownership", undefined);
  return [
    {
      ...state,
      owner: false,
      running: undefined,
      parked: undefined,
      cooling: false,
      retryAfterMillis: undefined,
    },
    state.running === undefined ? [CANCEL_SLEEP] : [INTERRUPT, CANCEL_SLEEP],
  ];
};

const onCadenceChange = (state: SessionState): SessionTransition =>
  state.owner && state.running === undefined && !state.cooling && state.suspended === undefined
    ? [state, [{ _tag: "sleep", cadence: cadenceOf(state), reset: false }]]
    : [state, NONE];

const onTimer = (state: SessionState): SessionTransition => {
  const next = state.cooling ? { ...state, cooling: false } : state;
  return next.owner && next.running === undefined && mayStart(next.suspended, "timer")
    ? startCycle(next, false)
    : [next, NONE];
};

const onFailure = (
  policy: SessionPolicy,
  state: SessionState,
  running: RunningStep,
  disposition: SyncFailureDisposition,
): SessionTransition => {
  const origin: CycleStep =
    running.step === "recover" ? (running.origin ?? "catchUp") : running.step;
  const failed: RunningStep = { ...running, failed: true };
  switch (disposition._tag) {
    case "recover":
      return running.step !== "recover" && policy.canRecover
        ? [
            { ...state, running: { ...running, step: "recover", origin: running.step } },
            [{ _tag: "run", step: "recover", code: disposition.code }],
          ]
        : afterFailure(state, failed, origin);
    case "suspend":
      return afterFailure({ ...state, suspended: disposition.suspension }, failed, origin);
    case "retry": {
      const delayed: SessionState =
        disposition.delayMillis === undefined
          ? state
          : {
              ...state,
              retryAfterMillis: Math.max(
                state.retryAfterMillis ?? 0,
                Math.min(disposition.delayMillis, policy.maxRetryAfterMillis),
              ),
            };
      const suspect = disposition.suspect;
      if (suspect === undefined) return afterFailure(delayed, failed, origin);
      const suspects = Math.min(state.suspects + 1, SUSPECT_LIMIT);
      return afterFailure(
        {
          ...delayed,
          suspects,
          suspended:
            suspects >= SUSPECT_LIMIT
              ? { ...suspect, blocks: "all", timer: true }
              : delayed.suspended,
        },
        { ...failed, slow: true },
        origin,
      );
    }
  }
};

const onStepEnded = (
  policy: SessionPolicy,
  state: SessionState,
  step: SessionStep,
  outcome: StepOutcome,
): SessionTransition => {
  const running = state.running;
  if (running === undefined || running.step !== step) return [state, NONE];
  if (outcome._tag === "failed") return onFailure(policy, state, running, outcome.disposition);
  switch (running.step) {
    case "register":
      return runNext(state, running, running.uploads ? "upload" : "catchUp");
    case "upload":
      return runNext(state, running, "catchUp");
    case "catchUp":
      return finishCycle(state, { ...running, advanced: running.advanced || outcome.advanced });
    case "recover": {
      const recovered = { ...state, fresh: true };
      return running.origin === "upload"
        ? runNext(recovered, running, "catchUp")
        : finishCycle(recovered, running);
    }
  }
};

export const step =
  (policy: SessionPolicy) =>
  (state: SessionState, event: SessionEvent): SessionTransition => {
    switch (event._tag) {
      case "wake":
        return onWake(state, event.reason, event.hint);
      case "owner":
        return onOwner(state, event.owned);
      case "visible":
        return state.visible === event.visible
          ? [state, NONE]
          : onCadenceChange({ ...state, visible: event.visible });
      case "live":
        return state.live === event.connected
          ? [state, NONE]
          : onCadenceChange({ ...state, live: event.connected });
      case "timer":
        return onTimer(state);
      case "stepEnded":
        return onStepEnded(policy, state, event.step, event.outcome);
    }
  };
