import { accumulateNotice, mergeAccumulators, noticeAffects } from "@store/client-db";
import type { NoticeAccumulator, ReplicaCommitNotice } from "@store/client-db";
import { attemptStore } from "@store/client-db/node-analytics";
import type { AnalyticsStore, InventorySource } from "@store/client-db/node-analytics";
import {
  insightsDayOf,
  stockPolicyVersion,
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
import type * as Scope from "effect/Scope";
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

export const makeAnalyticsScheduler = (deps: {
  readonly source: InventorySource;
  readonly store: AnalyticsStore;
}): Effect.Effect<AnalyticsScheduler, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wake = yield* Queue.dropping<void>(1);
    const journal = yield* makeChangeJournal();
    const state = yield* SynchronizedRef.make<SchedulerState>({
      desired: undefined,
      pending: undefined,
      verify: true,
      failure: null,
      phase: Phase.Idle(),
    });
    const event = yield* SubscriptionRef.make<InsightsChange>({
      revision: deps.store.publishedRun()?.revision ?? 0,
      state: "idle",
      progress: null,
    });

    const eventOf = (phase: Phase): InsightsChange => {
      const run = deps.store.publishedRun();
      return {
        revision: run?.revision ?? 0,
        state: stateOf(phase, run !== undefined),
        progress: progressOf(phase),
      };
    };

    const modifyAndPublish = <B>(f: (current: SchedulerState) => readonly [B, SchedulerState]) =>
      SynchronizedRef.modifyEffect(state, (current) => {
        const result = f(current);
        return SubscriptionRef.set(event, eventOf(result[1].phase)).pipe(Effect.as(result));
      });

    const transition = (f: (current: SchedulerState) => SchedulerState) =>
      modifyAndPublish((current) => [undefined, f(current)]);

    const reportProgress = (done: number, total: number) =>
      SynchronizedRef.updateEffect(state, (current) => {
        const { phase } = current;
        if (phase._tag !== "Running") return Effect.succeed(current);
        const step = total === 0 ? PROGRESS_STEPS : Math.floor((done * PROGRESS_STEPS) / total);
        const next = { ...current, phase: Phase.Running({ progress: { done, total }, step }) };
        return step === phase.step
          ? Effect.succeed(next)
          : SubscriptionRef.set(event, eventOf(next.phase)).pipe(Effect.as(next));
      });

    const cleanup = Effect.gen(function* () {
      const run = deps.store.publishedRun();
      let removed = 1;
      while (removed > 0) {
        removed = yield* attemptStore(() =>
          deps.store.discardSuperseded({
            keepResults: run === undefined ? [] : [run.runId],
            keepWork: [],
            limit: CLEANUP_BATCH,
          }),
        );
        yield* Effect.yieldNow;
      }
      yield* attemptStore(() => deps.store.checkpoint()).pipe(Effect.ignore);
    });

    const runOnce = Effect.gen(function* () {
      const context = (yield* SynchronizedRef.get(state)).desired;
      if (context === undefined) return;
      const { consumed, verifyStamp, outcome } = yield* journal.track((changes) =>
        Effect.gen(function* () {
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
        pending:
          value.kind !== "none" &&
          current.pending !== undefined &&
          current.pending.generationId === value.run.sourceGeneration &&
          current.pending.version <= value.run.sourceVersion
            ? undefined
            : current.pending,
      }));
      if (value.kind !== "none") yield* cleanup;
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
        Effect.andThen(runOnce),
        Effect.catchCause(() =>
          transition((current) => ({ ...current, failure: FAILURE_MESSAGE, phase: Phase.Idle() })),
        ),
      );

    yield* cycle(TIMING.startDelay, cleanup).pipe(
      Effect.andThen(cycle(TIMING.settle, Effect.void).pipe(Effect.forever)),
      Effect.forkScoped,
    );

    const schedule = transition((current) =>
      current.phase._tag === "Idle" ? { ...current, phase: Phase.Scheduled() } : current,
    ).pipe(Effect.andThen(Queue.offer(wake, undefined)));

    yield* Effect.gen(function* () {
      const context = (yield* SynchronizedRef.get(state)).desired;
      const run = deps.store.publishedRun();
      const now = yield* Clock.currentTimeMillis;
      if (
        context !== undefined &&
        run !== undefined &&
        run.today !== insightsDayOf(now, context.utcOffsetMinutes)
      ) {
        yield* schedule;
      }
    }).pipe(Effect.repeat(Schedule.spaced(ROLLOVER_CHECK)), Effect.forkScoped);

    const statusFor = (context: InsightsContext | undefined) =>
      Effect.gen(function* () {
        const run = deps.store.publishedRun();
        const current = yield* SynchronizedRef.get(state);
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
      notify: (notice) =>
        Effect.gen(function* () {
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
      observe: (context) =>
        Effect.gen(function* () {
          const before = yield* SynchronizedRef.getAndUpdate(state, (current) => ({
            ...current,
            desired: context,
          }));
          const run = deps.store.publishedRun();
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
