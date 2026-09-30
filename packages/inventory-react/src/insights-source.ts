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
  type RestockCursor,
  type RestockFilters,
  type RestockPageRead,
  type RestockPageRequest,
} from "@store/contracts";
import {
  analyzeInsights,
  ATTENTION_STATUSES,
  insightsWindowFor,
  type InsightsReport,
} from "@store/services/insights";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
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

type CachedReport = {
  readonly key: string;
  readonly revision: number;
  readonly run: AnalyticsRun;
  readonly report: InsightsReport;
};

const runOf = (
  report: InsightsReport,
  revision: number,
  stamp: { readonly generationId: string; readonly localCommitVersion: number },
): AnalyticsRun => ({
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

const summaryOf = (cached: CachedReport): InsightsSummary => {
  const { report, run } = cached;
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

const fallbackSource = (replica: ReplicaHandle): InsightsSource => {
  let cached: CachedReport | undefined;
  let revision = 0;
  const load = (context: InsightsContext) =>
    Effect.gen(function* () {
      const stamp = yield* Effect.tryPromise({ try: () => replica.stamp(), catch: readFailure });
      const now = Date.now();
      const window = insightsWindowFor(now, context.utcOffsetMinutes);
      const key = [
        stamp.generationId,
        stamp.localCommitVersion,
        stockPolicyVersion(context.policy),
        context.utcOffsetMinutes,
        window.until,
      ].join("|");
      if (cached?.key === key) return cached;
      const read = yield* Effect.tryPromise({
        try: () => replica.readInsights(window),
        catch: readFailure,
      });
      const report = analyzeInsights(read.facts, context.policy, now);
      revision += 1;
      cached = { key, revision, run: runOf(report, revision, read.stamp), report };
      return cached;
    }).pipe(Effect.withSpan("InventoryInsights.fallbackReport"));
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
          if (request.cursor !== null && request.cursor.runId !== current.revision) {
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
                ? cursorFor(current.revision, last)
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
  };
};

export const makeInsightsSource = (replica: ReplicaHandle): InsightsSource =>
  replica.analytics === undefined ? fallbackSource(replica) : nativeSource(replica.analytics);

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
