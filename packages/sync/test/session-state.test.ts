import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence, SyncEpoch } from "@store/contracts";
import { describe, expect, it } from "vitest";

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

const runsRegister = (commands: ReadonlyArray<SessionCommand>): boolean =>
  commands.some((command) => command._tag === "run" && command.step === "register");

const settles = (state: SessionState, outcomeFor: (name: SessionStep) => SessionEvent): boolean => {
  let current = state;
  for (let turn = 0; turn < 16; turn += 1) {
    if (current.running === undefined) return true;
    [current] = reduce(current, outcomeFor(current.running.step));
  }
  return current.running === undefined;
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
  const states = new Set(situations.map(({ state }) => JSON.stringify(state)));

  it("reaches a closed set of states", () => {
    expect(states.size).toBe(4588);
  });

  it("starts a cycle on focus from every owned idle state, after any Retry-After wait", () => {
    for (const { state, timerArmed } of situations) {
      if (!state.owner || state.running !== undefined) continue;
      const label = JSON.stringify({ state, timerArmed });
      const [focused, commands] = reduce(state, wake("focus"));
      if (!state.cooling) {
        expect(runsRegister(commands), label).toBe(true);
        continue;
      }
      expect(timerArmed, label).toBe(true);
      expect(commands, label).toEqual([]);
      const [waited, onTimer] = reduce(focused, { _tag: "timer" });
      expect(waited.cooling, label).toBe(false);
      expect(runsRegister(onTimer) || runsRegister(reduce(waited, wake("focus"))[1]), label).toBe(
        true,
      );
    }
  });

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

  it("leaves every running state through step outcomes", () => {
    for (const { state } of situations) {
      if (state.running === undefined) continue;
      expect(state.owner, JSON.stringify(state)).toBe(true);
      expect(state.cooling, JSON.stringify(state)).toBe(false);
      expect(
        settles(state, (name) => done(name)),
        JSON.stringify(state),
      ).toBe(true);
      for (const disposition of dispositions) {
        expect(
          settles(state, (name) => failed(name, disposition)),
          JSON.stringify({ state, disposition }),
        ).toBe(true);
      }
    }
  });

  it("suspends after three garbled responses and clears on the next clean cycle", () => {
    const failing: ReadonlyArray<SessionEvent> = [
      done("register"),
      done("upload"),
      failed("catchUp", garbled),
    ];
    const twice = play([{ _tag: "timer" }, ...failing, { _tag: "timer" }, ...failing], owned);
    expect(twice.state.suspended).toBeUndefined();
    expect(twice.commands).toEqual([{ _tag: "sleep", cadence: "slow", reset: false }]);
    const thrice = play([{ _tag: "timer" }, ...failing], twice.state);
    expect(thrice.state.suspended).toEqual({
      reason: "garbledResponses",
      message: "unreadable",
      blocks: "all",
      timer: true,
    });
    expect(thrice.commands).toEqual([{ _tag: "sleep", cadence: "slow", reset: false }]);
    const probing = play([{ _tag: "timer" }, done("register")], thrice.state);
    expect(probing.state.suspended?.reason).toBe("garbledResponses");
    expect(probing.commands).toEqual([{ _tag: "run", step: "upload" }]);
    const cleared = play([done("upload"), done("catchUp", true)], probing.state);
    expect(cleared.state.suspended).toBeUndefined();
    expect(cleared.state.suspects).toBe(0);
    expect(cleared.commands).toEqual([{ _tag: "sleep", cadence: "active", reset: true }]);
  });

  it("waits out a Retry-After without letting a wake start a cycle", () => {
    const cooling = play(
      [{ _tag: "timer" }, done("register"), done("upload"), failed("catchUp", retryAfter)],
      owned,
    );
    expect(cooling.commands).toEqual([{ _tag: "sleepFor", millis: 90_000 }]);
    expect(cooling.state.cooling).toBe(true);
    for (const reason of ["focus", "localWrite", "reconnect", "live", "timer"] as const) {
      expect(reduce(cooling.state, wake(reason))[1]).toEqual([]);
    }
    const [focused] = reduce(cooling.state, wake("focus"));
    expect(focused.fresh).toBe(true);
    expect(reduce(focused, { _tag: "timer" })[1]).toEqual([{ _tag: "run", step: "register" }]);
  });

  it("caps a Retry-After at the policy maximum", () => {
    const capped = play(
      [
        { _tag: "timer" },
        done("register"),
        done("upload"),
        failed("catchUp", { _tag: "retry", delayMillis: 86_400_000 }),
      ],
      owned,
    );
    expect(capped.commands).toEqual([{ _tag: "sleepFor", millis: 300_000 }]);
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

  it("keeps catching up under an uploads-only suspension and retries uploads on an explicit wake", () => {
    const blocked = play(
      [{ _tag: "timer" }, done("register"), failed("upload", sequenceGap), done("catchUp")],
      owned,
    );
    expect(blocked.state.suspended?.blocks).toBe("uploads");
    expect(blocked.commands).toEqual([{ _tag: "sleep", cadence: "active", reset: false }]);
    const polled = play([{ _tag: "timer" }, done("register")], blocked.state);
    expect(polled.commands).toEqual([{ _tag: "run", step: "catchUp" }]);
    const stillBlocked = play([done("catchUp")], polled.state);
    expect(stillBlocked.state.suspended?.blocks).toBe("uploads");
    const retried = play([wake("localWrite"), done("register")], stillBlocked.state);
    expect(retried.commands).toEqual([{ _tag: "run", step: "upload" }]);
    const cleared = play([done("upload"), done("catchUp")], retried.state);
    expect(cleared.state.suspended).toBeUndefined();
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
