import { accumulateNotice, mergeAccumulators, noticeAffects } from "@store/client-db";
import type { NoticeAccumulator, ReplicaCommitNotice } from "@store/client-db";
import type { AnalyticsStore, InventorySource } from "@store/client-db/node-analytics";
import {
  insightsDayOf,
  stockPolicyVersion,
  type AnalyticsStatus,
  type InsightsContext,
} from "@store/contracts";
import type { InsightsChange } from "@store/contracts/replica";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

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

type Activity = "idle" | "scheduled" | "running";

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
    const desired = yield* Ref.make<InsightsContext | undefined>(undefined);
    const pending = yield* Ref.make<NoticeAccumulator | undefined>(undefined);
    const activity = yield* Ref.make<Activity>("idle");
    const progress = yield* Ref.make<{ done: number; total: number } | null>(null);
    const failure = yield* Ref.make<string | null>(null);
    const verify = yield* Ref.make(true);
    const delayed = yield* Ref.make(false);
    const event = yield* SubscriptionRef.make<InsightsChange>({
      revision: deps.store.publishedRun()?.revision ?? 0,
      state: "idle",
      progress: null,
    });

    const stateOf = (current: Activity, hasRun: boolean): InsightsChange["state"] =>
      current === "idle" ? "idle" : hasRun ? "refreshing" : "building";

    const publishEvent = Effect.gen(function* () {
      const run = deps.store.publishedRun();
      const current = yield* Ref.get(activity);
      yield* SubscriptionRef.set(event, {
        revision: run?.revision ?? 0,
        state: stateOf(current, run !== undefined),
        progress: yield* Ref.get(progress),
      });
    });

    const setActivity = (next: Activity) =>
      Ref.set(activity, next).pipe(Effect.andThen(publishEvent));

    const lastStep = yield* Ref.make(-1);

    const reportProgress = (done: number, total: number) =>
      Effect.gen(function* () {
        yield* Ref.set(progress, { done, total });
        const step = total === 0 ? PROGRESS_STEPS : Math.floor((done * PROGRESS_STEPS) / total);
        if (step !== (yield* Ref.getAndSet(lastStep, step))) yield* publishEvent;
      });

    const cleanup = Effect.gen(function* () {
      const run = deps.store.publishedRun();
      let removed = 1;
      while (removed > 0) {
        removed = deps.store.discardSuperseded({
          keepResults: run === undefined ? [] : [run.runId],
          keepWork: [],
          limit: CLEANUP_BATCH,
        });
        yield* Effect.yieldNow;
      }
      yield* Effect.try(() => deps.store.checkpoint()).pipe(Effect.ignore);
    });

    const bootCleanupDone = yield* Ref.make(false);
    const bootCleanup = Effect.flatMap(Ref.getAndSet(bootCleanupDone, true), (done) =>
      done ? Effect.void : cleanup,
    );

    const runOnce = Effect.gen(function* () {
      const context = yield* Ref.get(desired);
      if (context === undefined) return;
      const { consumed, verifyStamp, outcome } = yield* journal.track((changes) =>
        Effect.gen(function* () {
          const consumed = yield* Ref.getAndSet(pending, undefined);
          yield* Ref.set(activity, "running");
          yield* Ref.set(progress, null);
          yield* Ref.set(lastStep, -1);
          yield* publishEvent;
          const verifyStamp = yield* Ref.getAndSet(verify, false);
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
      yield* Ref.set(progress, null);
      if (outcome._tag === "Failure") {
        yield* Ref.set(failure, "The insights could not be recalculated.");
        if (verifyStamp) yield* Ref.set(verify, true);
        yield* Ref.update(pending, (later) =>
          consumed === undefined ? later : mergeAccumulators(consumed, later),
        );
        yield* Ref.set(activity, "idle");
        yield* publishEvent;
        return;
      }
      yield* Ref.set(failure, null);
      const value = outcome.value;
      if (value.kind !== "none") {
        yield* Ref.update(pending, (later) =>
          later !== undefined &&
          later.generationId === value.run.sourceGeneration &&
          later.version <= value.run.sourceVersion
            ? undefined
            : later,
        );
        yield* cleanup;
      }
      const later = yield* Ref.get(pending);
      const desiredNow = yield* Ref.get(desired);
      const contextMoved =
        desiredNow !== undefined &&
        (stockPolicyVersion(desiredNow.policy) !== stockPolicyVersion(context.policy) ||
          desiredNow.utcOffsetMinutes !== context.utcOffsetMinutes);
      yield* Ref.set(activity, later !== undefined || contextMoved ? "scheduled" : "idle");
      yield* publishEvent;
      if (later !== undefined || contextMoved) yield* Queue.offer(wake, undefined);
      yield* Effect.sleep(TIMING.minGap);
    });

    yield* Queue.take(wake).pipe(
      Effect.andThen(
        Effect.flatMap(Ref.getAndSet(delayed, true), (already) =>
          Effect.sleep(already ? TIMING.settle : TIMING.startDelay),
        ),
      ),
      Effect.andThen(Queue.clear(wake)),
      Effect.andThen(bootCleanup),
      Effect.andThen(runOnce),
      Effect.catchCause(() =>
        Ref.set(failure, "The insights could not be recalculated.").pipe(
          Effect.andThen(setActivity("idle")),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const schedule = Effect.gen(function* () {
      yield* Ref.update(activity, (current) => (current === "idle" ? "scheduled" : current));
      yield* publishEvent;
      yield* Queue.offer(wake, undefined);
    });

    yield* Effect.gen(function* () {
      const context = yield* Ref.get(desired);
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
        const current = yield* Ref.get(activity);
        const now = yield* Clock.currentTimeMillis;
        return {
          state: stateOf(current, run !== undefined),
          progress: yield* Ref.get(progress),
          policyCurrent:
            run === undefined ||
            context === undefined ||
            (run.policyVersion === stockPolicyVersion(context.policy) &&
              run.utcOffsetMinutes === context.utcOffsetMinutes),
          dateCurrent:
            run === undefined ||
            context === undefined ||
            run.today === insightsDayOf(now, context.utcOffsetMinutes),
          failure: yield* Ref.get(failure),
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
          yield* Ref.update(pending, (current) => accumulateNotice(current, notice));
          if ((yield* Ref.get(desired)) !== undefined) yield* schedule;
        }),
      observe: (context) =>
        Effect.gen(function* () {
          const previous = yield* Ref.getAndSet(desired, context);
          const run = deps.store.publishedRun();
          const now = yield* Clock.currentTimeMillis;
          const stale =
            previous === undefined ||
            run === undefined ||
            run.policyVersion !== stockPolicyVersion(context.policy) ||
            run.utcOffsetMinutes !== context.utcOffsetMinutes ||
            run.today !== insightsDayOf(now, context.utcOffsetMinutes) ||
            (yield* Ref.get(pending)) !== undefined ||
            (yield* Ref.get(verify));
          if (stale) yield* schedule;
          return yield* statusFor(context);
        }),
      events: SubscriptionRef.changes(event),
    } satisfies AnalyticsScheduler;
  });
