import { describe, expect, it } from "@effect/vitest";
import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence, SyncEpoch } from "@store/contracts";

import {
  initialSessionState,
  step,
  type SessionCommand,
  type SessionEvent,
  type SessionState,
  type SessionStep,
  type StepOutcome,
} from "../src/session-state";
import type { SyncFailureDisposition } from "../src/transport";

const reduce = step({ maxRetryAfterMillis: 300_000, canRecover: true });

const hint = {
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  horizon: OrgCommitSequence.make("7"),
};

const garbled: SyncFailureDisposition = {
  _tag: "retry",
  delayMillis: undefined,
  suspect: { reason: "garbledResponses", message: "unreadable" },
};

const offline: SyncFailureDisposition = { _tag: "retry", delayMillis: undefined };

const retryAfter: SyncFailureDisposition = { _tag: "retry", delayMillis: 90_000 };

const sequenceGap: SyncFailureDisposition = {
  _tag: "suspend",
  suspension: {
    reason: "recoveryRequired",
    message: "gap",
    code: "REPLICA_SEQUENCE_GAP",
    blocks: "uploads",
    timer: false,
  },
};

const dispositions: ReadonlyArray<SyncFailureDisposition> = [
  offline,
  retryAfter,
  garbled,
  { _tag: "recover", code: "SNAPSHOT_REQUIRED" },
  {
    _tag: "suspend",
    suspension: { reason: "auth", message: "sign in", blocks: "all", timer: true },
  },
  {
    _tag: "suspend",
    suspension: { reason: "protocol", message: "refused", blocks: "all", timer: false },
  },
  sequenceGap,
];

const ended = (name: SessionStep, outcome: StepOutcome): SessionEvent => ({
  _tag: "stepEnded",
  step: name,
  outcome,
});

const done = (name: SessionStep, advanced = false): SessionEvent =>
  ended(name, { _tag: "done", advanced });

const failed = (name: SessionStep, disposition: SyncFailureDisposition): SessionEvent =>
  ended(name, { _tag: "failed", disposition });

const wake = (reason: Extract<SessionEvent, { _tag: "wake" }>["reason"]): SessionEvent => ({
  _tag: "wake",
  reason,
});

const ambient: ReadonlyArray<SessionEvent> = [
  wake("startup"),
  wake("ownership"),
  wake("localWrite"),
  wake("focus"),
  wake("reconnect"),
  wake("timer"),
  wake("live"),
  { _tag: "wake", reason: "live", hint },
  { _tag: "owner", owned: true },
  { _tag: "owner", owned: false },
  { _tag: "visible", visible: true },
  { _tag: "visible", visible: false },
  { _tag: "live", connected: true },
  { _tag: "live", connected: false },
  { _tag: "timer" },
];

const eventsFor = (state: SessionState): ReadonlyArray<SessionEvent> => {
  const running = state.running;
  if (running === undefined) return [...ambient, done("catchUp")];
  return [
    ...ambient,
    done(running.step, false),
    done(running.step, true),
    ...dispositions.map((disposition) => failed(running.step, disposition)),
  ];
};

type Situation = { readonly state: SessionState; readonly timerArmed: boolean };

const timerAfter = (
  armed: boolean,
  event: SessionEvent,
  commands: ReadonlyArray<SessionCommand>,
): boolean => {
  let timerArmed = event._tag === "timer" ? false : armed;
  for (const command of commands) {
    if (command._tag === "sleep" || command._tag === "sleepFor") timerArmed = true;
    if (command._tag === "cancelSleep") timerArmed = false;
  }
  return timerArmed;
};

const explore = () => {
  const start: Situation = { state: initialSessionState, timerArmed: false };
  const seen = new Map<string, Situation>([[JSON.stringify(start), start]]);
  let frontier: ReadonlyArray<Situation> = [start];
  while (frontier.length > 0) {
    const next: Array<Situation> = [];
    for (const from of frontier) {
      for (const event of eventsFor(from.state)) {
        const [state, commands] = reduce(from.state, event);
        const to = { state, timerArmed: timerAfter(from.timerArmed, event, commands) };
        const key = JSON.stringify(to);
        if (seen.has(key)) continue;
        seen.set(key, to);
        next.push(to);
      }
    }
    expect(seen.size).toBeLessThan(200_000);
    frontier = next;
  }
  return [...seen.values()];
};

const play = (events: ReadonlyArray<SessionEvent>, from: SessionState = initialSessionState) => {
  let state = from;
  let commands: ReadonlyArray<SessionCommand> = [];
  for (const event of events) [state, commands] = reduce(state, event);
  return { state, commands };
};

const cleanCycle: ReadonlyArray<SessionEvent> = [done("register"), done("upload"), done("catchUp")];

const owned = play([{ _tag: "owner", owned: true }, ...cleanCycle]).state;

describe("sync session reducer", () => {
  const situations = explore();

  it("keeps a timer armed in every owned idle state that a timer may leave", () => {
    for (const { state, timerArmed } of situations) {
      const label = JSON.stringify({ state, timerArmed });
      if (state.running !== undefined) {
        expect(timerArmed, label).toBe(false);
        continue;
      }
      if (!state.owner) continue;
      const waitsForExplicitWake =
        state.suspended !== undefined && state.suspended.blocks === "all" && !state.suspended.timer;
      if (!timerArmed) expect(waitsForExplicitWake && !state.cooling, label).toBe(true);
    }
  });

  it("interrupts the running step when ownership is lost", () => {
    const running = play([{ _tag: "timer" }, done("register")], owned);
    const lost = reduce(running.state, { _tag: "owner", owned: false });
    expect(lost[1]).toEqual([{ _tag: "interrupt" }, { _tag: "cancelSleep" }]);
    expect(lost[0].running).toBeUndefined();
    expect(reduce(lost[0], done("upload"))).toEqual([lost[0], []]);
    expect(reduce(lost[0], { _tag: "owner", owned: true })[1]).toEqual([
      { _tag: "cancelSleep" },
      { _tag: "run", step: "register" },
    ]);
  });

  it("recovers once per failed step and resumes the cycle from where it failed", () => {
    const snapshot: SyncFailureDisposition = { _tag: "recover", code: "SNAPSHOT_REQUIRED" };
    const recovering = play(
      [{ _tag: "timer" }, done("register"), failed("upload", snapshot)],
      owned,
    );
    expect(recovering.commands).toEqual([
      { _tag: "run", step: "recover", code: "SNAPSHOT_REQUIRED" },
    ]);
    expect(reduce(recovering.state, done("recover"))[1]).toEqual([
      { _tag: "run", step: "catchUp" },
    ]);
    const [again, commands] = reduce(recovering.state, failed("recover", snapshot));
    expect(commands).toEqual([{ _tag: "run", step: "catchUp" }]);
    expect(again.running?.failed).toBe(true);
  });

  it("parks wakes that arrive mid-cycle and reruns or rechecks when the cycle ends", () => {
    const running = play([{ _tag: "timer" }, done("register"), done("upload")], owned);
    const hinted = reduce(running.state, { _tag: "wake", reason: "live", hint })[0];
    expect(reduce(hinted, done("catchUp"))[1]).toEqual([
      { _tag: "recheck", hint },
      { _tag: "sleep", cadence: "active", reset: true },
    ]);
    const written = reduce(hinted, wake("localWrite"))[0];
    expect(reduce(written, done("catchUp"))[1]).toEqual([{ _tag: "run", step: "register" }]);
  });
});
