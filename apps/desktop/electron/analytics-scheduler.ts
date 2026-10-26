import { accumulateNotice, mergeAccumulators, noticeAffects } from "@store/client-db";
import type { NoticeAccumulator, ReplicaCommitNotice } from "@store/client-db";
import type { AnalyticsStore, InventorySource } from "@store/client-db/node-analytics";
import {
  insightsDayOf,
  stockPolicyVersion,
  type AnalyticsRun,
  type AnalyticsStatus,
  type InsightsContext,
} from "@store/contracts";
import type { InsightsChange } from "@store/contracts/replica";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { makeChangeJournal, RELEVANT_ENTITIES } from "./analytics-changes";
import { refreshAnalytics } from "./analytics-pipeline";

const PROGRESS_STEPS = 20;
const CLEANUP_BATCH = 5_000;
const ROLLOVER_CHECK = Duration.minutes(15);

const TIMING = {
  startDelay: Duration.seconds(2),
  settle: Duration.millis(750),
  minGap: Duration.seconds(5),
  retryDelay: Duration.seconds(5),
  retries: 2,
};

type Progress = { readonly done: number; readonly total: number };

type Phase = Data.TaggedEnum<{
  Idle: {};
  Scheduled: {};
  Running: { readonly progress: Progress | null; readonly step: number };
}>;
const Phase = Data.taggedEnum<Phase>();

type SchedulerState = {
  readonly published: AnalyticsRun | undefined;
  readonly desired: InsightsContext | undefined;
  readonly pending: NoticeAccumulator | undefined;
  readonly verify: boolean;
  readonly failure: string | null;
  readonly phase: Phase;
};

const FAILURE_MESSAGE = "The insights could not be recalculated.";

const stateOf = (phase: Phase, hasRun: boolean): InsightsChange["state"] =>
  phase._tag === "Idle" ? "idle" : hasRun ? "refreshing" : "building";

const progressOf = (phase: Phase): Progress | null =>
  phase._tag === "Running" ? phase.progress : null;

const contextMoved = (desired: InsightsContext | undefined, context: InsightsContext) =>
  desired !== undefined &&
  (stockPolicyVersion(desired.policy) !== stockPolicyVersion(context.policy) ||
    desired.utcOffsetMinutes !== context.utcOffsetMinutes);

export type AnalyticsScheduler = {
  readonly notify: (notice: ReplicaCommitNotice) => Effect.Effect<void>;
  readonly observe: (context: InsightsContext) => Effect.Effect<AnalyticsStatus>;
  readonly events: Stream.Stream<InsightsChange>;
};

export const makeAnalyticsScheduler = Effect.fn("AnalyticsScheduler.make")(function* (deps: {
  readonly source: InventorySource;
  readonly store: AnalyticsStore;
}) {
  const firstRun = yield* deps.store.publishedRun();
  const wake = yield* Queue.dropping<void>(1);
  const journal = yield* makeChangeJournal();
  const state = yield* SynchronizedRef.make<SchedulerState>({
    published: firstRun,
    desired: undefined,
    pending: undefined,
    verify: true,
    failure: null,
    phase: Phase.Idle(),
  });
  const event = yield* SubscriptionRef.make<InsightsChange>({
    revision: firstRun?.revision ?? 0,
    state: "idle",
    progress: null,
  });

  const publishEvent = ({ published, phase }: SchedulerState) =>
    SubscriptionRef.set(event, {
      revision: published?.revision ?? 0,
      state: stateOf(phase, published !== undefined),
      progress: progressOf(phase),
    });

  const modifyAndPublish = <B>(f: (current: SchedulerState) => readonly [B, SchedulerState]) =>
    SynchronizedRef.modifyEffect(state, (current) => {
      const result = f(current);
      return publishEvent(result[1]).pipe(Effect.as(result));
    });

  const transition = (f: (current: SchedulerState) => SchedulerState) =>
    modifyAndPublish((current) => [undefined, f(current)]);

  const reportProgress = (done: number, total: number) =>
    SynchronizedRef.updateEffect(state, (current) => {
      const { phase } = current;
      if (phase._tag !== "Running") return Effect.succeed(current);
      const step = total === 0 ? PROGRESS_STEPS : Math.floor((done * PROGRESS_STEPS) / total);
      const next = { ...current, phase: Phase.Running({ progress: { done, total }, step }) };
      return step === phase.step ? Effect.succeed(next) : publishEvent(next).pipe(Effect.as(next));
    });

  const cleanup = Effect.fn("AnalyticsScheduler.cleanup")(function* () {
    const { published } = yield* SynchronizedRef.get(state);
    yield* deps.store
      .discardSuperseded({
        keepResults: published === undefined ? [] : [published.runId],
        keepWork: [],
        limit: CLEANUP_BATCH,
      })
      .pipe(Effect.tap(Effect.yieldNow), Effect.repeat({ while: (removed) => removed > 0 }));
    yield* deps.store.checkpoint().pipe(Effect.ignore);
  });

  const runOnce = Effect.fn("AnalyticsScheduler.runOnce")(function* () {
    const context = (yield* SynchronizedRef.get(state)).desired;
    if (context === undefined) return;
    const { consumed, verifyStamp, outcome } = yield* journal.track(
      Effect.fn("AnalyticsScheduler.refresh")(function* (changes) {
        const { consumed, verifyStamp } = yield* modifyAndPublish((current) => [
          { consumed: current.pending, verifyStamp: current.verify },
          {
            ...current,
            pending: undefined,
            verify: false,
            phase: Phase.Running({ progress: null, step: -1 }),
          },
        ]);
        const outcome = yield* refreshAnalytics(
          { ...deps, changes, progress: reportProgress },
          { context, pending: consumed, verifyStamp },
        ).pipe(
          Effect.retry({
            schedule: Schedule.spaced(TIMING.retryDelay).pipe(
              Schedule.upTo({ times: TIMING.retries }),
            ),
          }),
          Effect.exit,
        );
        return { consumed, verifyStamp, outcome };
      }),
    );
    if (outcome._tag === "Failure") {
      yield* transition((current) => ({
        ...current,
        failure: FAILURE_MESSAGE,
        verify: current.verify || verifyStamp,
        pending:
          consumed === undefined ? current.pending : mergeAccumulators(consumed, current.pending),
        phase: Phase.Idle(),
      }));
      return;
    }
    const value = outcome.value;
    yield* SynchronizedRef.update(state, (current) => ({
      ...current,
      failure: null,
      phase: Phase.Running({ progress: null, step: -1 }),
      published: value.kind === "none" ? current.published : value.run,
      pending:
        value.kind !== "none" &&
        current.pending !== undefined &&
        current.pending.generationId === value.run.sourceGeneration &&
        current.pending.version <= value.run.sourceVersion
          ? undefined
          : current.pending,
    }));
    if (value.kind !== "none") yield* cleanup();
    const again = yield* modifyAndPublish((current) => {
      const rerun = current.pending !== undefined || contextMoved(current.desired, context);
      return [rerun, { ...current, phase: rerun ? Phase.Scheduled() : Phase.Idle() }];
    });
    if (again) yield* Queue.offer(wake, undefined);
    yield* Effect.sleep(TIMING.minGap);
  });

  const cycle = (delay: Duration.Duration, prelude: Effect.Effect<void, unknown>) =>
    Queue.take(wake).pipe(
      Effect.andThen(Effect.sleep(delay)),
      Effect.andThen(Queue.clear(wake)),
      Effect.andThen(prelude),
      Effect.andThen(runOnce()),
      Effect.catchCause(() =>
        transition((current) => ({ ...current, failure: FAILURE_MESSAGE, phase: Phase.Idle() })),
      ),
    );

  yield* cycle(TIMING.startDelay, cleanup()).pipe(
    Effect.andThen(cycle(TIMING.settle, Effect.void).pipe(Effect.forever)),
    Effect.forkScoped,
  );

  const schedule = transition((current) =>
    current.phase._tag === "Idle" ? { ...current, phase: Phase.Scheduled() } : current,
  ).pipe(Effect.andThen(Queue.offer(wake, undefined)));

  yield* Effect.fn("AnalyticsScheduler.checkRollover")(function* () {
    const { desired: context, published: run } = yield* SynchronizedRef.get(state);
    const now = yield* Clock.currentTimeMillis;
    if (
      context !== undefined &&
      run !== undefined &&
      run.today !== insightsDayOf(now, context.utcOffsetMinutes)
    ) {
      yield* schedule;
    }
  })().pipe(Effect.repeat(Schedule.spaced(ROLLOVER_CHECK)), Effect.forkScoped);

  const statusFor = Effect.fn("AnalyticsScheduler.statusFor")(function* (
    context: InsightsContext | undefined,
  ) {
    const current = yield* SynchronizedRef.get(state);
    const run = current.published;
    const now = yield* Clock.currentTimeMillis;
    return {
      state: stateOf(current.phase, run !== undefined),
      progress: progressOf(current.phase),
      policyCurrent:
        run === undefined ||
        context === undefined ||
        (run.policyVersion === stockPolicyVersion(context.policy) &&
          run.utcOffsetMinutes === context.utcOffsetMinutes),
      dateCurrent:
        run === undefined ||
        context === undefined ||
        run.today === insightsDayOf(now, context.utcOffsetMinutes),
      failure: current.failure,
    } satisfies AnalyticsStatus;
  });

  return {
    notify: Effect.fn("AnalyticsScheduler.notify")(function* (notice: ReplicaCommitNotice) {
      yield* journal.record(notice);
      const relevant =
        notice.fullInvalidation === true ||
        RELEVANT_ENTITIES.some((entity) => noticeAffects(notice, entity));
      if (!relevant) return;
      const current = yield* SynchronizedRef.updateAndGet(state, (latest) => ({
        ...latest,
        pending: accumulateNotice(latest.pending, notice),
      }));
      if (current.desired !== undefined) yield* schedule;
    }),
    observe: Effect.fn("AnalyticsScheduler.observe")(function* (context: InsightsContext) {
      const before = yield* SynchronizedRef.getAndUpdate(state, (current) => ({
        ...current,
        desired: context,
      }));
      const run = before.published;
      const now = yield* Clock.currentTimeMillis;
      const stale =
        before.desired === undefined ||
        run === undefined ||
        run.policyVersion !== stockPolicyVersion(context.policy) ||
        run.utcOffsetMinutes !== context.utcOffsetMinutes ||
        run.today !== insightsDayOf(now, context.utcOffsetMinutes) ||
        before.pending !== undefined ||
        before.verify;
      if (stale) yield* schedule;
      return yield* statusFor(context);
    }),
    events: SubscriptionRef.changes(event),
  } satisfies AnalyticsScheduler;
});
