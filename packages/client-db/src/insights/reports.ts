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
import type { InsightsChange, ReadFailure, Stamp } from "@store/contracts/replica";
import {
  analyzeInsights,
  ATTENTION_STATUSES,
  insightsWindowFor,
  type InsightsReport,
} from "@store/services/insights";
import { ReplicaStore } from "@store/sync";
import { SqliteReplica } from "@store/sync/sql-client";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { AnalyticsStore } from "../analytics/store";
import { readFailure } from "../store/failures";
import { readInsightsFacts, readReplicaStamp } from "./facts";

type AnalyticsRuns = {
  readonly store: Pick<AnalyticsStore, "published" | "products" | "restockPage">;
  readonly observe: (context: InsightsContext) => Effect.Effect<AnalyticsStatus>;
  readonly changes: Stream.Stream<InsightsChange>;
};

const COMMITS_SETTLE = Duration.millis(750);

const COMPUTED_STATUS: AnalyticsStatus = {
  state: "idle",
  progress: null,
  policyCurrent: true,
  dateCurrent: true,
  failure: null,
};

const REPORT_CAPACITY = 2;

type ComputedReport = {
  readonly run: AnalyticsRun;
  readonly report: InsightsReport;
};

type ReportKey = Stamp & {
  readonly policy: StockPolicy;
  readonly utcOffsetMinutes: number;
  readonly until: number;
};

type PublishedReport = {
  readonly key: ReportKey;
  readonly current: ComputedReport;
};

type ReportState = {
  readonly revision: number;
  readonly published: ReadonlyArray<PublishedReport>;
};

const reportKeyOf = (
  stamp: Stamp,
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

const runOf = (report: InsightsReport, revision: number, stamp: Stamp): AnalyticsRun => ({
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

const summaryOf = ({ report, run }: ComputedReport): InsightsSummary => {
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

const productsOf = (
  { report, run }: ComputedReport,
  ids: ReadonlyArray<string>,
): ProductInsightsRead => {
  const wanted = new Set(ids);
  const found = new Map(
    report.products
      .filter((insight) => wanted.has(insight.productId))
      .map((insight) => [insight.productId, insight] as const),
  );
  return {
    run,
    insights: ids.flatMap((id) => {
      const insight = found.get(id);
      return insight === undefined ? [] : [insight];
    }),
    status: COMPUTED_STATUS,
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

const restockPageOf = (
  { report, run }: ComputedReport,
  request: RestockPageRequest,
): RestockPageRead => {
  const cursor = request.cursor;
  if (cursor !== null && cursor.runId !== run.revision) {
    return {
      run,
      rows: [],
      nextCursor: null,
      total: null,
      cursorExpired: true,
      status: COMPUTED_STATUS,
    };
  }
  const matching = report.products.filter(matchesFilters(request.filters));
  const start =
    cursor === null
      ? 0
      : matching.findIndex((insight) => insight.productId === cursor.productId) + 1;
  const rows = matching.slice(start, start + request.limit);
  const last = rows.at(-1);
  return {
    run,
    rows,
    nextCursor:
      start + request.limit < matching.length && last !== undefined
        ? cursorFor(run.revision, last)
        : null,
    total: cursor === null ? matching.length : null,
    cursorExpired: false,
    status: COMPUTED_STATUS,
  };
};

export class InsightsReports extends Context.Service<
  InsightsReports,
  {
    readonly summary: (context: InsightsContext) => Effect.Effect<InsightsSummaryRead, ReadFailure>;
    readonly products: (
      context: InsightsContext,
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<ProductInsightsRead, ReadFailure>;
    readonly restockPage: (
      context: InsightsContext,
      request: RestockPageRequest,
    ) => Effect.Effect<RestockPageRead, ReadFailure>;
    readonly changes: Stream.Stream<InsightsChange>;
  }
>()("@store/client-db/InsightsReports") {
  static readonly layerAnalytics = ({ store, observe, changes }: AnalyticsRuns) => {
    const stored = <A>(read: () => A) => Effect.try({ try: read, catch: readFailure });
    return Layer.succeed(
      InsightsReports,
      InsightsReports.of({
        summary: Effect.fn("InsightsReports.summary")(function* (context) {
          const status = yield* observe(context);
          const published = yield* stored(() => store.published());
          return { summary: published?.summary ?? null, status };
        }),
        products: Effect.fn("InsightsReports.products")(function* (context, ids) {
          const status = yield* observe(context);
          const found = yield* stored(() => store.products(ids));
          return { run: found.run ?? null, insights: found.insights, status };
        }),
        restockPage: Effect.fn("InsightsReports.restockPage")(function* (context, request) {
          const status = yield* observe(context);
          const page = yield* stored(() => store.restockPage(request));
          return page === undefined
            ? { run: null, rows: [], nextCursor: null, total: 0, cursorExpired: false, status }
            : { ...page, status };
        }),
        changes,
      }),
    );
  };

  static readonly layerReplica = Layer.effect(
    InsightsReports,
    Effect.gen(function* () {
      const replica = yield* SqliteReplica;
      const store = yield* ReplicaStore;
      const state = yield* Ref.make<ReportState>({ revision: 0, published: [] });

      const publish = (key: ReportKey, report: InsightsReport, stamp: Stamp) =>
        Ref.modify(state, (current): [ComputedReport, ReportState] => {
          const existing = current.published.find((entry) => supersedes(entry.key, key));
          if (existing !== undefined) return [existing.current, current];
          const revision = current.revision + 1;
          const produced: ComputedReport = { run: runOf(report, revision, stamp), report };
          return [
            produced,
            {
              revision,
              published: [
                { key, current: produced },
                ...current.published.filter((entry) => !sameSeries(entry.key, key)),
              ].slice(0, REPORT_CAPACITY),
            },
          ];
        });

      const reports = yield* Cache.make({
        lookup: Effect.fn("InsightsReports.compute")(function* (requested: ReportKey) {
          const existing = (yield* Ref.get(state)).published.find((entry) =>
            supersedes(entry.key, requested),
          );
          if (existing !== undefined) return existing.current;
          const now = yield* Clock.currentTimeMillis;
          const window = insightsWindowFor(now, requested.utcOffsetMinutes);
          const read = yield* readInsightsFacts(replica, window);
          const report = analyzeInsights(read.facts, requested.policy, now);
          return yield* publish(
            reportKeyOf(read.stamp, requested.policy, window),
            report,
            read.stamp,
          );
        }),
        capacity: REPORT_CAPACITY,
        timeToLive: Duration.zero,
      });

      const load = Effect.fn("InsightsReports.load")(function* (context: InsightsContext) {
        const stamp = yield* readReplicaStamp(replica);
        const now = yield* Clock.currentTimeMillis;
        return yield* Cache.get(
          reports,
          reportKeyOf(stamp, context.policy, insightsWindowFor(now, context.utcOffsetMinutes)),
        );
      });

      return InsightsReports.of({
        summary: (context) =>
          Effect.map(load(context), (current) => ({
            summary: summaryOf(current),
            status: COMPUTED_STATUS,
          })),
        products: (context, ids) =>
          Effect.map(load(context), (current) => productsOf(current, ids)),
        restockPage: (context, request) =>
          Effect.map(load(context), (current) => restockPageOf(current, request)),
        changes: store.commits.pipe(
          Stream.debounce(COMMITS_SETTLE),
          Stream.map((notice): InsightsChange => ({
            revision: notice.localCommitVersion,
            state: "idle",
            progress: null,
          })),
        ),
      });
    }),
  );
}
