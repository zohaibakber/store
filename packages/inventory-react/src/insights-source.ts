import type { ReplicaAnalytics, ReplicaHandle } from "@store/client-db";
import {
  ANALYTICS_ALGORITHM_VERSION,
  RESTOCK_VIEW_STATUSES,
  stockPolicyVersion,
  SUMMARY_ATTENTION_LIMIT,
  SUMMARY_EXPIRING_LIMIT,
  type AnalyticsRun,
  type AnalyticsStatus,
  type InsightsContext,
  type InsightsSummary,
  type InsightsSummaryRead,
  type ProductInsight,
  type ProductInsightsRead,
  type ReplicaInsightsWindow,
  type RestockCursor,
  type RestockFilters,
  type RestockPageRead,
  type RestockPageRequest,
  type StockPolicy,
} from "@store/contracts";
import {
  analyzeInsights,
  ATTENTION_STATUSES,
  insightsWindowFor,
  type InsightsReport,
} from "@store/services/insights";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { WorkspaceReadFailure } from "./errors";

const INSIGHTS_SETTLE = Duration.millis(750);
const FALLBACK_STATUS: AnalyticsStatus = {
  state: "idle",
  progress: null,
  policyCurrent: true,
  dateCurrent: true,
  failure: null,
};

export type InsightsSource = {
  readonly readSummary: (
    context: InsightsContext,
  ) => Effect.Effect<InsightsSummaryRead, WorkspaceReadFailure>;
  readonly readProducts: (
    context: InsightsContext,
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ProductInsightsRead, WorkspaceReadFailure>;
  readonly readRestockPage: (
    context: InsightsContext,
    request: RestockPageRequest,
  ) => Effect.Effect<RestockPageRead, WorkspaceReadFailure>;
  readonly changes: Stream.Stream<void>;
};

const readFailure = () => new WorkspaceReadFailure({ message: "Local replica storage failed." });

const signals = (subscribe: (notify: () => void) => () => void) =>
  Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => subscribe(() => Queue.offerUnsafe(queue, undefined))),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );

const nativeSource = (analytics: ReplicaAnalytics): InsightsSource => ({
  readSummary: (context) =>
    Effect.tryPromise({ try: () => analytics.readSummary(context), catch: readFailure }),
  readProducts: (context, ids) =>
    Effect.tryPromise({ try: () => analytics.readProducts(context, ids), catch: readFailure }),
  readRestockPage: (context, request) =>
    Effect.tryPromise({
      try: () => analytics.readRestockPage(context, request),
      catch: readFailure,
    }),
  changes: signals((notify) => analytics.subscribe(() => notify())),
});

type FallbackReport = {
  readonly run: AnalyticsRun;
  readonly report: InsightsReport;
};

type ReportStamp = {
  readonly generationId: string;
  readonly localCommitVersion: number;
};

type ReportKey = ReportStamp & {
  readonly policy: StockPolicy;
  readonly utcOffsetMinutes: number;
  readonly until: number;
};

const reportKeyOf = (
  stamp: ReportStamp,
  policy: StockPolicy,
  window: ReplicaInsightsWindow,
): ReportKey => ({
  generationId: stamp.generationId,
  localCommitVersion: stamp.localCommitVersion,
  policy,
  utcOffsetMinutes: window.utcOffsetMinutes,
  until: window.until,
});

const sameSeries = (left: ReportKey, right: ReportKey) =>
  left.generationId === right.generationId &&
  left.utcOffsetMinutes === right.utcOffsetMinutes &&
  left.until === right.until &&
  Equal.equals(left.policy, right.policy);

const supersedes = (published: ReportKey, key: ReportKey) =>
  sameSeries(published, key) && published.localCommitVersion >= key.localCommitVersion;

type PublishedReport = {
  readonly key: ReportKey;
  readonly current: FallbackReport;
};

type ReportState = {
  readonly open: boolean;
  readonly revision: number;
  readonly published: ReadonlyArray<PublishedReport>;
};

const REPORT_CAPACITY = 2;

const closedFailure = () => new WorkspaceReadFailure({ message: "The workspace is closed." });

const runOf = (report: InsightsReport, revision: number, stamp: ReportStamp): AnalyticsRun => ({
  runId: revision,
  revision,
  kind: "full",
  completedAt: report.generatedAt,
  generatedAt: report.generatedAt,
  sourceGeneration: stamp.generationId,
  sourceVersion: stamp.localCommitVersion,
  policyVersion: stockPolicyVersion(report.policy),
  algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
  today: report.today,
  utcOffsetMinutes: report.utcOffsetMinutes,
  productCount: report.products.length,
});

const summaryOf = ({ report, run }: FallbackReport): InsightsSummary => {
  const attention = report.products.filter((insight) => ATTENTION_STATUSES.has(insight.status));
  return {
    run,
    generatedAt: report.generatedAt,
    today: report.today,
    utcOffsetMinutes: report.utcOffsetMinutes,
    policy: report.policy,
    productCount: report.products.length,
    counts: report.counts,
    alerts: report.alerts,
    attention: attention.slice(0, SUMMARY_ATTENTION_LIMIT),
    attentionCount: attention.length,
    expiring: report.expiring.slice(0, SUMMARY_EXPIRING_LIMIT),
    expiringCount: report.expiring.length,
    inventory: report.inventory,
    sales: report.sales,
  };
};

const matchesFilters = (filters: RestockFilters) => {
  const statuses = new Set<string>(RESTOCK_VIEW_STATUSES[filters.view]);
  const term = filters.search?.trim().toLowerCase() ?? "";
  return (insight: ProductInsight) =>
    statuses.has(insight.status) &&
    (filters.ordersOnly !== true || insight.order !== null) &&
    (term === "" || insight.name.toLowerCase().includes(term));
};

const cursorFor = (revision: number, insight: ProductInsight): RestockCursor => ({
  runId: revision,
  revision,
  priority: insight.priority,
  nameKey: insight.name.toLowerCase(),
  productId: insight.productId,
});

const fallbackSource = Effect.fnUntraced(function* (replica: ReplicaHandle) {
  const state = yield* Ref.make<ReportState>({ open: true, revision: 0, published: [] });
  const closing = yield* Deferred.make<never, WorkspaceReadFailure>();
  const publish = (key: ReportKey, report: InsightsReport, stamp: ReportStamp) =>
    Ref.modify(state, (current): [Exit.Exit<FallbackReport, WorkspaceReadFailure>, ReportState] => {
      if (!current.open) return [Exit.fail(closedFailure()), current];
      const existing = current.published.find((entry) => supersedes(entry.key, key));
      if (existing !== undefined) return [Exit.succeed(existing.current), current];
      const revision = current.revision + 1;
      const produced: FallbackReport = { run: runOf(report, revision, stamp), report };
      return [
        Exit.succeed(produced),
        {
          open: true,
          revision,
          published: [
            { key, current: produced },
            ...current.published.filter((entry) => !sameSeries(entry.key, key)),
          ].slice(0, REPORT_CAPACITY),
        },
      ];
    }).pipe(Effect.flatten);
  const reports: Cache.Cache<ReportKey, FallbackReport, WorkspaceReadFailure> = yield* Cache.make({
    lookup: (requested: ReportKey) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (!current.open) return yield* Effect.fail(closedFailure());
        const existing = current.published.find((entry) => supersedes(entry.key, requested));
        if (existing !== undefined) return existing.current;
        const now = yield* Clock.currentTimeMillis;
        const window = insightsWindowFor(now, requested.utcOffsetMinutes);
        const read = yield* Effect.tryPromise({
          try: () => replica.readInsights(window),
          catch: readFailure,
        });
        const report = analyzeInsights(read.facts, requested.policy, now);
        return yield* publish(
          reportKeyOf(read.stamp, requested.policy, window),
          report,
          read.stamp,
        );
      }).pipe(
        Effect.raceFirst(Deferred.await(closing)),
        Effect.withSpan("InventoryInsights.fallbackReport"),
      ),
    capacity: REPORT_CAPACITY,
    timeToLive: Duration.zero,
  });
  yield* Effect.addFinalizer(() =>
    Ref.set(state, { open: false, revision: 0, published: [] }).pipe(
      Effect.andThen(Deferred.fail(closing, closedFailure())),
      Effect.andThen(Cache.invalidateAll(reports)),
    ),
  );
  const load = (context: InsightsContext) =>
    Effect.gen(function* () {
      if (!(yield* Ref.get(state)).open) return yield* Effect.fail(closedFailure());
      const stamp = yield* Effect.tryPromise({ try: () => replica.stamp(), catch: readFailure });
      const now = yield* Clock.currentTimeMillis;
      return yield* Cache.get(
        reports,
        reportKeyOf(stamp, context.policy, insightsWindowFor(now, context.utcOffsetMinutes)),
      );
    });
  return {
    readSummary: (context) =>
      load(context).pipe(
        Effect.map((current) => ({ summary: summaryOf(current), status: FALLBACK_STATUS })),
      ),
    readProducts: (context, ids) =>
      load(context).pipe(
        Effect.map((current) => {
          const wanted = new Set(ids);
          const found = new Map(
            current.report.products
              .filter((insight) => wanted.has(insight.productId))
              .map((insight) => [insight.productId, insight] as const),
          );
          return {
            run: current.run,
            insights: ids.flatMap((id) => {
              const insight = found.get(id);
              return insight === undefined ? [] : [insight];
            }),
            status: FALLBACK_STATUS,
          };
        }),
      ),
    readRestockPage: (context, request) =>
      load(context).pipe(
        Effect.map((current): RestockPageRead => {
          if (request.cursor !== null && request.cursor.runId !== current.run.revision) {
            return {
              run: current.run,
              rows: [],
              nextCursor: null,
              total: null,
              cursorExpired: true,
              status: FALLBACK_STATUS,
            };
          }
          const matching = current.report.products.filter(matchesFilters(request.filters));
          const cursor = request.cursor;
          const start =
            cursor === null
              ? 0
              : matching.findIndex((insight) => insight.productId === cursor.productId) + 1;
          const rows = matching.slice(start, start + request.limit);
          const last = rows.at(-1);
          return {
            run: current.run,
            rows,
            nextCursor:
              start + request.limit < matching.length && last !== undefined
                ? cursorFor(current.run.revision, last)
                : null,
            total: cursor === null ? matching.length : null,
            cursorExpired: false,
            status: FALLBACK_STATUS,
          };
        }),
      ),
    changes: signals((notify) => replica.subscribe(() => notify())).pipe(
      Stream.debounce(INSIGHTS_SETTLE),
    ),
  } satisfies InsightsSource;
});

export const makeInsightsSource = (
  replica: ReplicaHandle,
): Effect.Effect<InsightsSource, never, Scope.Scope> =>
  replica.analytics === undefined
    ? fallbackSource(replica)
    : Effect.succeed(nativeSource(replica.analytics));

export const emptyInsightsSource: InsightsSource = {
  readSummary: () => Effect.succeed({ summary: null, status: FALLBACK_STATUS }),
  readProducts: () => Effect.succeed({ run: null, insights: [], status: FALLBACK_STATUS }),
  readRestockPage: () =>
    Effect.succeed({
      run: null,
      rows: [],
      nextCursor: null,
      total: 0,
      cursorExpired: false,
      status: FALLBACK_STATUS,
    }),
  changes: Stream.never,
};
