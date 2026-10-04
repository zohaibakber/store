import * as Schema from "effect/Schema";

import { OPEN_PURCHASE_ORDER_STATUSES } from "../catalog/purchasing";
import { EpochMillis, PositiveInt, UtcOffsetMinutes } from "../schema-primitives";

export const INSIGHTS_DAY_MILLIS = 86_400_000;
export const INSIGHTS_HOUR_MILLIS = 3_600_000;
const MAX_INSIGHTS_WINDOW_DAYS = 400;
export const MAX_INSIGHTS_PRODUCTS = 20_000;
export const MAX_INSIGHTS_BATCHES = 60_000;
export const MAX_INSIGHTS_SALES = 250_000;
export const MAX_INSIGHTS_ON_ORDER = MAX_INSIGHTS_PRODUCTS;
export const INSIGHTS_ON_ORDER_STATUSES = OPEN_PURCHASE_ORDER_STATUSES;

export const ReplicaInsightsWindow = Schema.Struct({
  since: EpochMillis,
  until: EpochMillis,
  utcOffsetMinutes: UtcOffsetMinutes,
}).check(
  Schema.makeFilter(
    (window) =>
      window.until > window.since &&
      window.until - window.since <= MAX_INSIGHTS_WINDOW_DAYS * INSIGHTS_DAY_MILLIS,
    { title: "Insights window within the bounded history" },
  ),
);
export type ReplicaInsightsWindow = typeof ReplicaInsightsWindow.Type;

export const InsightsProductFact = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  categoryId: Schema.String,
  categoryName: Schema.NullOr(Schema.String),
  tracksPacks: Schema.Boolean,
  unitsPerPack: PositiveInt,
  purchasePrice: Schema.NullOr(Schema.Number),
  retailPrice: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
  visible: Schema.Boolean,
  createdAt: EpochMillis,
});
export type InsightsProductFact = typeof InsightsProductFact.Type;

export const InsightsBatchFact = Schema.Struct({
  productId: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  packQuantity: Schema.Int,
  unitQuantity: Schema.Int,
  expiresAt: Schema.NullOr(Schema.Number),
});
export type InsightsBatchFact = typeof InsightsBatchFact.Type;

const InsightsSaleFact = Schema.Struct({
  productId: Schema.String,
  day: Schema.Int,
  units: Schema.Int,
  revenue: Schema.Number,
});

export const InsightsOnOrderFact = Schema.Struct({
  productId: Schema.String,
  units: PositiveInt,
});
export type InsightsOnOrderFact = typeof InsightsOnOrderFact.Type;

const InsightsDayFact = Schema.Struct({
  day: Schema.Int,
  invoices: Schema.Natural,
  revenue: Schema.Number,
});

const InsightsHourFact = Schema.Struct({
  hour: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 })),
  invoices: Schema.Natural,
  revenue: Schema.Number,
});

export const ReplicaInsightsFacts = Schema.Struct({
  window: ReplicaInsightsWindow,
  products: Schema.Array(InsightsProductFact),
  batches: Schema.Array(InsightsBatchFact),
  sales: Schema.Array(InsightsSaleFact),
  onOrder: Schema.Array(InsightsOnOrderFact),
  days: Schema.Array(InsightsDayFact),
  hours: Schema.Array(InsightsHourFact),
  truncated: Schema.Boolean,
});
export type ReplicaInsightsFacts = typeof ReplicaInsightsFacts.Type;

export const insightsDayOf = (epochMillis: number, utcOffsetMinutes: number) =>
  Math.floor((epochMillis + utcOffsetMinutes * 60_000) / INSIGHTS_DAY_MILLIS);

export const insightsDayStart = (day: number, utcOffsetMinutes: number) =>
  day * INSIGHTS_DAY_MILLIS - utcOffsetMinutes * 60_000;
