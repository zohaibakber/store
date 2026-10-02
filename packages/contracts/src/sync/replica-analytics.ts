import * as Schema from "effect/Schema";

import { EpochMillis, UtcOffsetMinutes } from "../internal/primitives";
import { PositiveInt, SyncIdentifier } from "../schema-primitives";

export const MAX_PRODUCT_INSIGHT_IDS = 200;
export const MAX_RESTOCK_PAGE_ROWS = 100;
const MAX_RESTOCK_SEARCH_LENGTH = 100;
export const ANALYTICS_ALGORITHM_VERSION = 2;
export const SUMMARY_ATTENTION_LIMIT = 8;
export const SUMMARY_EXPIRING_LIMIT = 50;
export const ANALYTICS_HISTORY_DAYS = 180;

const between = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isBetween({ minimum, maximum }));
const wholeBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const StockPolicy = Schema.Struct({
  leadDays: wholeBetween(0, 90),
  coverDays: wholeBetween(1, 120),
  serviceLevel: between(0.8, 0.995),
  minimumUnits: wholeBetween(0, 10_000),
  expiryWarningDays: wholeBetween(7, 365),
  deadStockDays: wholeBetween(14, 365),
  overstockDays: wholeBetween(30, 730),
});
export type StockPolicy = typeof StockPolicy.Type;

export const stockPolicyVersion = (policy: StockPolicy): string =>
  [
    policy.leadDays,
    policy.coverDays,
    policy.serviceLevel,
    policy.minimumUnits,
    policy.expiryWarningDays,
    policy.deadStockDays,
    policy.overstockDays,
  ].join(".");

export const AbcClass = Schema.Literals(["A", "B", "C"]);
export type AbcClass = typeof AbcClass.Type;

export const StockStatus = Schema.Literals([
  "out",
  "critical",
  "low",
  "dead",
  "overstock",
  "healthy",
  "inactive",
]);
export type StockStatus = typeof StockStatus.Type;

export const DemandForecast = Schema.Struct({
  dailyRate: Schema.Number,
  dailyDeviation: Schema.Number,
  pattern: Schema.Literals(["smooth", "erratic", "intermittent", "lumpy", "sparse", "none"]),
  method: Schema.Literals(["ses", "sba", "average", "none"]),
  confidence: Schema.Literals(["high", "medium", "low"]),
  trend: Schema.Literals(["rising", "falling", "steady", "unknown"]),
  trendRatio: Schema.NullOr(Schema.Number),
  observedDays: Schema.Natural,
  sellingDays: Schema.Natural,
  meanAbsoluteError: Schema.NullOr(Schema.Number),
});
export type DemandForecast = typeof DemandForecast.Type;

export const OrderSuggestion = Schema.Struct({
  quantity: Schema.Number,
  unit: Schema.Literals(["packs", "units"]),
  baseUnits: Schema.Number,
  cost: Schema.NullOr(Schema.Number),
});
export type OrderSuggestion = typeof OrderSuggestion.Type;

export const ProductInsight = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  categoryName: Schema.NullOr(Schema.String),
  unitsPerPack: Schema.Number,
  tracksPacks: Schema.Boolean,
  abc: AbcClass,
  status: StockStatus,
  demand: DemandForecast,
  onHandUnits: Schema.Number,
  availableUnits: Schema.Number,
  expiredUnits: Schema.Number,
  expiryRiskUnits: Schema.Number,
  usableUnits: Schema.Number,
  nearestExpiry: Schema.NullOr(Schema.Number),
  daysOfCover: Schema.NullOr(Schema.Number),
  stockoutAt: Schema.NullOr(Schema.Number),
  safetyStock: Schema.Number,
  reorderPoint: Schema.Number,
  orderUpTo: Schema.Number,
  onOrderUnits: Schema.Number,
  order: Schema.NullOr(OrderSuggestion),
  unitCost: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
  stockValueAtCost: Schema.NullOr(Schema.Number),
  stockValueAtRetail: Schema.NullOr(Schema.Number),
  units30d: Schema.Number,
  units90d: Schema.Number,
  revenue90d: Schema.Number,
  daysSinceLastSale: Schema.NullOr(Schema.Number),
  lostRevenuePerDay: Schema.Number,
  priority: Schema.Number,
});
export type ProductInsight = typeof ProductInsight.Type;

export const ExpiringBatch = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
  units: Schema.Number,
  atRiskUnits: Schema.Number,
  valueAtCost: Schema.NullOr(Schema.Number),
});
export type ExpiringBatch = typeof ExpiringBatch.Type;

export const InsightSeverity = Schema.Literals(["critical", "warning", "info", "positive"]);
export type InsightSeverity = typeof InsightSeverity.Type;

export const InsightKind = Schema.Literals([
  "stockout",
  "runningOut",
  "reorder",
  "expired",
  "expiryRisk",
  "deadStock",
  "overstock",
  "risingDemand",
  "fallingDemand",
  "missingCosts",
  "truncated",
]);
export type InsightKind = typeof InsightKind.Type;

export const InsightAlert = Schema.Struct({
  id: Schema.String,
  kind: InsightKind,
  severity: InsightSeverity,
  productId: Schema.NullOr(Schema.String),
  title: Schema.String,
  detail: Schema.String,
  impact: Schema.Number,
});
export type InsightAlert = typeof InsightAlert.Type;

export const SALES_RANGE_DAYS = [7, 30, 90] as const;
export const SalesRange = Schema.Literals(SALES_RANGE_DAYS);
export type SalesRange = typeof SalesRange.Type;

export const SalesDay = Schema.Struct({
  day: Schema.Int,
  date: Schema.Number,
  revenue: Schema.Number,
  invoices: Schema.Natural,
  previousRevenue: Schema.Number,
});
export type SalesDay = typeof SalesDay.Type;

export const TopProduct = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  revenue: Schema.Number,
  units: Schema.Number,
  share: Schema.Number,
  trend: DemandForecast.fields.trend,
});
export type TopProduct = typeof TopProduct.Type;

export const SalesPeriod = Schema.Struct({
  days: SalesRange,
  revenue: Schema.Number,
  invoices: Schema.Natural,
  averageBasket: Schema.NullOr(Schema.Number),
  grossProfit: Schema.NullOr(Schema.Number),
  margin: Schema.NullOr(Schema.Number),
  costCoverage: Schema.Number,
  previousRevenue: Schema.Number,
  previousInvoices: Schema.Natural,
  revenueChange: Schema.NullOr(Schema.Number),
  invoicesChange: Schema.NullOr(Schema.Number),
  series: Schema.Array(SalesDay),
  topProducts: Schema.Array(TopProduct),
});
export type SalesPeriod = typeof SalesPeriod.Type;

export const InsightsInventoryTotals = Schema.Struct({
  valueAtCost: Schema.Number,
  valueAtRetail: Schema.Number,
  deadStockValue: Schema.Number,
  expiryRiskValue: Schema.Number,
  expiredValue: Schema.Number,
  reorderCost: Schema.Number,
  reorderCount: Schema.Natural,
  missingCostCount: Schema.Natural,
});
export type InsightsInventoryTotals = typeof InsightsInventoryTotals.Type;

export const InsightsSalesSummary = Schema.Struct({
  today: Schema.Struct({ revenue: Schema.Number, invoices: Schema.Natural }),
  periods: Schema.Struct({ 7: SalesPeriod, 30: SalesPeriod, 90: SalesPeriod }),
  weekdays: Schema.Array(Schema.Struct({ weekday: Schema.Int, revenue: Schema.Number })),
  hours: Schema.Array(Schema.Struct({ hour: Schema.Int, invoices: Schema.Natural })),
  peakHour: Schema.NullOr(Schema.Int),
});
export type InsightsSalesSummary = typeof InsightsSalesSummary.Type;

export const StockStatusCounts = Schema.Struct({
  out: Schema.Natural,
  critical: Schema.Natural,
  low: Schema.Natural,
  dead: Schema.Natural,
  overstock: Schema.Natural,
  healthy: Schema.Natural,
  inactive: Schema.Natural,
});
export type StockStatusCounts = typeof StockStatusCounts.Type;

export const AnalyticsRun = Schema.Struct({
  runId: PositiveInt,
  revision: PositiveInt,
  kind: Schema.Literals(["full", "incremental"]),
  completedAt: EpochMillis,
  generatedAt: EpochMillis,
  sourceGeneration: Schema.String,
  sourceVersion: Schema.Natural,
  policyVersion: Schema.String,
  algorithmVersion: PositiveInt,
  today: Schema.Int,
  utcOffsetMinutes: UtcOffsetMinutes,
  productCount: Schema.Natural,
});
export type AnalyticsRun = typeof AnalyticsRun.Type;

export const AnalyticsStatus = Schema.Struct({
  state: Schema.Literals(["idle", "building", "refreshing"]),
  progress: Schema.NullOr(Schema.Struct({ done: Schema.Natural, total: Schema.Natural })),
  policyCurrent: Schema.Boolean,
  dateCurrent: Schema.Boolean,
  failure: Schema.NullOr(Schema.String),
});
export type AnalyticsStatus = typeof AnalyticsStatus.Type;

export const InsightsContext = Schema.Struct({
  policy: StockPolicy,
  utcOffsetMinutes: UtcOffsetMinutes,
});
export type InsightsContext = typeof InsightsContext.Type;

export const InsightsSummary = Schema.Struct({
  run: AnalyticsRun,
  generatedAt: EpochMillis,
  today: Schema.Int,
  utcOffsetMinutes: UtcOffsetMinutes,
  policy: StockPolicy,
  productCount: Schema.Natural,
  counts: StockStatusCounts,
  alerts: Schema.Array(InsightAlert),
  attention: Schema.Array(ProductInsight),
  attentionCount: Schema.Natural,
  expiring: Schema.Array(ExpiringBatch),
  expiringCount: Schema.Natural,
  inventory: InsightsInventoryTotals,
  sales: InsightsSalesSummary,
});
export type InsightsSummary = typeof InsightsSummary.Type;

export const InsightsSummaryRead = Schema.Struct({
  summary: Schema.NullOr(InsightsSummary),
  status: AnalyticsStatus,
});
export type InsightsSummaryRead = typeof InsightsSummaryRead.Type;

export const ProductInsightIds = Schema.Array(SyncIdentifier).check(
  Schema.isMaxLength(MAX_PRODUCT_INSIGHT_IDS),
);

export const ProductInsightsRead = Schema.Struct({
  run: Schema.NullOr(AnalyticsRun),
  insights: Schema.Array(ProductInsight),
  status: AnalyticsStatus,
});
export type ProductInsightsRead = typeof ProductInsightsRead.Type;

export const RESTOCK_VIEWS = [
  "action",
  "out",
  "critical",
  "low",
  "overstock",
  "dead",
  "all",
] as const;
export const RestockView = Schema.Literals(RESTOCK_VIEWS);
export type RestockView = typeof RestockView.Type;

export const RESTOCK_VIEW_STATUSES = {
  action: ["out", "critical", "low"],
  out: ["out"],
  critical: ["critical"],
  low: ["low"],
  overstock: ["overstock"],
  dead: ["dead"],
  all: ["out", "critical", "low", "dead", "overstock", "healthy"],
} as const satisfies Record<RestockView, ReadonlyArray<StockStatus>>;

export const RestockFilters = Schema.Struct({
  view: RestockView,
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_RESTOCK_SEARCH_LENGTH))),
  ordersOnly: Schema.optional(Schema.Boolean),
});
export type RestockFilters = typeof RestockFilters.Type;

export const RestockCursor = Schema.Struct({
  runId: PositiveInt,
  revision: PositiveInt,
  priority: Schema.Number,
  nameKey: Schema.String,
  productId: Schema.String,
});
export type RestockCursor = typeof RestockCursor.Type;

export const RestockPageRequest = Schema.Struct({
  filters: RestockFilters,
  cursor: Schema.NullOr(RestockCursor),
  limit: wholeBetween(1, MAX_RESTOCK_PAGE_ROWS),
});
export type RestockPageRequest = typeof RestockPageRequest.Type;

export const RestockPageRead = Schema.Struct({
  run: Schema.NullOr(AnalyticsRun),
  rows: Schema.Array(ProductInsight),
  nextCursor: Schema.NullOr(RestockCursor),
  total: Schema.NullOr(Schema.Natural),
  cursorExpired: Schema.Boolean,
  status: AnalyticsStatus,
});
export type RestockPageRead = typeof RestockPageRead.Type;
