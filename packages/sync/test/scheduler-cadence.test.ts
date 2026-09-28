import { describe, expect, it } from "@effect/vitest";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  type SyncLiveWakeHint,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import {
  defaultHttpPollPolicy,
  LIVE_IDLE_PULL_MILLIS,
  makeSyncScheduler,
  PULL_FLOOR_MILLIS,
  type SyncCatchUpOutcome,
  type SyncSchedulerPolicy,
} from "../src/scheduler";
import { type SyncFailureCause, SyncTransportUnavailable } from "../src/transport";

const policy: SyncSchedulerPolicy = {
  activePollMillis: 1_000,
  backoffMillis: [2_000, 4_000, 8_000],
  hiddenPollMillis: 6_000,
  liveIdlePollMillis: 30_000,
  maxRetryAfterMillis: 600_000,
};

const hint = (horizon: string): SyncLiveWakeHint => ({
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  horizon: OrgCommitSequence.make(horizon),
});

type PullScript = (attempt: number) => Effect.Effect<SyncCatchUpOutcome, SyncFailureCause>;

const startScheduler = (
  script: PullScript,
  options: { readonly appliedThrough?: bigint; readonly policy?: SyncSchedulerPolicy } = {},
) =>
  Effect.gen(function* () {
    const pulls = yield* Ref.make<ReadonlyArray<number>>([]);
    const scheduler = yield* makeSyncScheduler(
      {
        drainUpload: () => Effect.void,
        catchUp: () =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const seen = yield* Ref.updateAndGet(pulls, (times) => [...times, now]);
            return yield* script(seen.length);
          }),
        hintApplied: (wake) =>
          Effect.succeed(
            options.appliedThrough !== undefined && BigInt(wake.horizon) <= options.appliedThrough,
          ),
      },
      options.policy ?? policy,
    );
    yield* scheduler.setNetworkOwner(true);
    yield* TestClock.adjust("0 millis");
    return { pulls, scheduler };
  });

const advance = (millis: number) =>
  Effect.repeat(TestClock.adjust("100 millis"), { times: Math.ceil(millis / 100) - 1 });

const gapsOf = (times: ReadonlyArray<number>): ReadonlyArray<number> =>
  times.slice(1).map((time, index) => time - (times[index] ?? 0));

const expectWithinJitter = (gap: number | undefined, expected: number) => {
  expect(gap).toBeGreaterThanOrEqual(expected * 0.8 - 100);
  expect(gap).toBeLessThanOrEqual(expected * 1.2 + 100);
};

const unchanged: PullScript = () => Effect.succeed("unchanged");

describe("sync scheduler idle cadence", () => {
  it("starts the default ladder at the one-minute floor and idles for fifteen minutes when live", () => {
    expect(defaultHttpPollPolicy.activePollMillis).toBe(PULL_FLOOR_MILLIS);
    expect(defaultHttpPollPolicy.minPollMillis).toBe(60_000);
    expect(defaultHttpPollPolicy.backoffMillis).toEqual([60_000, 120_000, 300_000]);
    expect(defaultHttpPollPolicy.liveIdlePollMillis).toBe(LIVE_IDLE_PULL_MILLIS);
    expect(LIVE_IDLE_PULL_MILLIS).toBe(15 * 60_000);
  });

  it.effect("never polls faster than the floor without a socket, even while pulls advance", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(() => Effect.succeed("advanced"), {
        policy: defaultHttpPollPolicy,
      });
      for (let step = 0; step < 80; step += 1) yield* TestClock.adjust("15 seconds");
      const gaps = gapsOf(yield* Ref.get(pulls));
      expect(gaps.length).toBeGreaterThanOrEqual(7);
      for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(PULL_FLOOR_MILLIS);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("climbs the default ladder to five minutes while nothing changes", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged, {
        policy: defaultHttpPollPolicy,
      });
      for (let step = 0; step < 30; step += 1) yield* TestClock.adjust("1 minute");
      const gaps = gapsOf(yield* Ref.get(pulls));
      expectWithinJitter(gaps[0], 60_000);
      expectWithinJitter(gaps[1], 120_000);
      expectWithinJitter(gaps[2], 300_000);
      expectWithinJitter(gaps[3], 300_000);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("pulls once per fifteen minutes while the socket stays connected", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged, {
        policy: defaultHttpPollPolicy,
      });
      yield* scheduler.setLiveConnected(true);
      for (let step = 0; step < 60; step += 1) yield* TestClock.adjust("1 minute");
      const gaps = gapsOf(yield* Ref.get(pulls));
      expect(gaps.length).toBeGreaterThanOrEqual(3);
      for (const gap of gaps) expectWithinJitter(gap, LIVE_IDLE_PULL_MILLIS);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("climbs the idle ladder while pulls return no transactions", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged);
      yield* advance(40_000);
      const gaps = gapsOf(yield* Ref.get(pulls));
      expectWithinJitter(gaps[0], 2_000);
      expectWithinJitter(gaps[1], 4_000);
      expectWithinJitter(gaps[2], 8_000);
      expectWithinJitter(gaps[3], 8_000);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("keeps the active cadence while pulls apply transactions", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(() => Effect.succeed("advanced"));
      yield* advance(6_000);
      const gaps = gapsOf(yield* Ref.get(pulls));
      expect(gaps.length).toBeGreaterThanOrEqual(4);
      for (const gap of gaps) expectWithinJitter(gap, 1_000);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("resets the ladder on a local write, focus, or reconnect wake", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged);
      yield* advance(20_000);
      for (const reason of ["localWrite", "focus", "reconnect"] as const) {
        const before = (yield* Ref.get(pulls)).length;
        yield* scheduler.wake(reason);
        yield* TestClock.adjust("0 millis");
        expect((yield* Ref.get(pulls)).length).toBe(before + 1);
        yield* advance(2_500);
        expect((yield* Ref.get(pulls)).length).toBe(before + 2);
        yield* advance(10_000);
      }
      yield* scheduler.shutdown;
    }),
  );

  it.effect("holds the hidden cadence as the floor of the idle ladder", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged);
      yield* scheduler.setVisible(false);
      yield* advance(40_000);
      const gaps = gapsOf(yield* Ref.get(pulls));
      expectWithinJitter(gaps[0], 6_000);
      expectWithinJitter(gaps[1], 6_000);
      expectWithinJitter(gaps[2], 8_000);
      yield* scheduler.shutdown;
    }),
  );
});

describe("sync scheduler live cadence", () => {
  it.effect("polls at the live idle cadence while the live channel stays connected", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged);
      yield* scheduler.setLiveConnected(true);
      for (let emptyWait = 0; emptyWait < 3; emptyWait += 1) {
        yield* scheduler.setLiveConnected(true);
        yield* advance(7_000);
      }
      expect((yield* Ref.get(pulls)).length).toBe(1);
      yield* advance(16_000);
      const times = yield* Ref.get(pulls);
      expect(times.length).toBe(2);
      expectWithinJitter(gapsOf(times)[0], 30_000);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("returns to the idle ladder as soon as the live channel reports a transport loss", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged);
      yield* scheduler.setLiveConnected(true);
      yield* advance(40_000);
      const beforeLoss = (yield* Ref.get(pulls)).length;
      yield* scheduler.setLiveConnected(false);
      yield* advance(10_000);
      expect((yield* Ref.get(pulls)).length).toBe(beforeLoss + 1);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("skips a live hint the replica has already applied", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged, { appliedThrough: 5n });
      yield* scheduler.setLiveConnected(true);
      yield* advance(2_500);
      const settled = (yield* Ref.get(pulls)).length;
      yield* scheduler.wake("live", hint("5"));
      yield* TestClock.adjust("0 millis");
      expect((yield* Ref.get(pulls)).length).toBe(settled);
      yield* scheduler.wake("live", hint("6"));
      yield* TestClock.adjust("0 millis");
      expect((yield* Ref.get(pulls)).length).toBe(settled + 1);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("coalesces wakes queued during one cycle into one pull", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler(unchanged);
      const before = (yield* Ref.get(pulls)).length;
      yield* scheduler.wake("localWrite");
      yield* scheduler.wake("localWrite");
      yield* scheduler.wake("live", hint("9"));
      yield* TestClock.adjust("0 millis");
      expect((yield* Ref.get(pulls)).length).toBe(before + 1);
      yield* scheduler.shutdown;
    }),
  );
});

describe("sync scheduler Retry-After", () => {
  it.effect("defers explicit wakes until the server's retry window has passed", () =>
    Effect.gen(function* () {
      const { pulls, scheduler } = yield* startScheduler((attempt) =>
        attempt === 1
          ? Effect.fail(
              SyncTransportUnavailable.make({
                message: "busy",
                status: 503,
                retryAfterMillis: 30_000,
              }),
            )
          : Effect.succeed("unchanged"),
      );
      expect((yield* Ref.get(pulls)).length).toBe(1);
      yield* TestClock.adjust("1 second");
      yield* scheduler.wake("localWrite");
      yield* TestClock.adjust("28 seconds");
      expect((yield* Ref.get(pulls)).length).toBe(1);
      yield* TestClock.adjust("1 second");
      expect((yield* Ref.get(pulls)).length).toBe(2);
      yield* scheduler.shutdown;
    }),
  );
});
