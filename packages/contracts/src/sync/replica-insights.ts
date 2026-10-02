import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import { OPEN_PURCHASE_ORDER_STATUSES, purchaseOrderLineRemaining } from "../catalog/purchasing";
import { EpochMillis, UtcOffsetMinutes } from "../internal/primitives";
import { PositiveInt } from "../schema-primitives";

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
type InsightsSaleFact = typeof InsightsSaleFact.Type;

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

const insightsHourOf = (epochMillis: number, utcOffsetMinutes: number) => {
  const local = epochMillis + utcOffsetMinutes * 60_000;
  const withinDay = ((local % INSIGHTS_DAY_MILLIS) + INSIGHTS_DAY_MILLIS) % INSIGHTS_DAY_MILLIS;
  return Math.floor(withinDay / INSIGHTS_HOUR_MILLIS);
};

export const insightsDayStart = (day: number, utcOffsetMinutes: number) =>
  day * INSIGHTS_DAY_MILLIS - utcOffsetMinutes * 60_000;

type InsightsInvoice = {
  readonly id: string;
  readonly createdAt: number;
  readonly total: number;
};

type InsightsInvoiceLine = {
  readonly productId: string;
  readonly baseUnitQuantity: number;
  readonly quantity: number;
  readonly salePrice: number;
};

type InsightsSalesAccumulator = {
  readonly addInvoice: (
    invoice: InsightsInvoice,
    lines: ReadonlyArray<InsightsInvoiceLine>,
  ) => boolean;
  readonly result: () => {
    readonly sales: ReadonlyArray<InsightsSaleFact>;
    readonly days: ReadonlyArray<typeof InsightsDayFact.Type>;
    readonly hours: ReadonlyArray<typeof InsightsHourFact.Type>;
    readonly truncated: boolean;
  };
};

export const makeInsightsSalesAccumulator = (
  window: ReplicaInsightsWindow,
): InsightsSalesAccumulator => {
  const sales = new Map<
    string,
    { productId: string; day: number; units: number; revenue: number }
  >();
  const days = new Map<number, { day: number; invoices: number; revenue: number }>();
  const hours = new Map<number, { hour: number; invoices: number; revenue: number }>();
  let truncated = false;
  return {
    addInvoice: (invoice, lines) => {
      if (invoice.createdAt < window.since || invoice.createdAt >= window.until) return true;
      const day = insightsDayOf(invoice.createdAt, window.utcOffsetMinutes);
      const hour = insightsHourOf(invoice.createdAt, window.utcOffsetMinutes);
      const dayFact = days.get(day) ?? { day, invoices: 0, revenue: 0 };
      dayFact.invoices += 1;
      dayFact.revenue += invoice.total;
      days.set(day, dayFact);
      const hourFact = hours.get(hour) ?? { hour, invoices: 0, revenue: 0 };
      hourFact.invoices += 1;
      hourFact.revenue += invoice.total;
      hours.set(hour, hourFact);
      for (const line of lines) {
        const key = `${line.productId}\u0000${day}`;
        const existing = sales.get(key);
        if (existing === undefined && sales.size >= MAX_INSIGHTS_SALES) {
          truncated = true;
          return false;
        }
        const fact = existing ?? { productId: line.productId, day, units: 0, revenue: 0 };
        fact.units += line.baseUnitQuantity;
        fact.revenue += line.quantity * line.salePrice;
        sales.set(key, fact);
      }
      return true;
    },
    result: () => ({
      sales: [...sales.values()],
      days: [...days.values()].sort((left, right) => left.day - right.day),
      hours: [...hours.values()].sort((left, right) => left.hour - right.hour),
      truncated,
    }),
  };
};

type InsightsOpenOrderLine = {
  readonly productId: string;
  readonly baseUnitQuantity: number;
  readonly receivedBaseUnits: number;
};

const byProductId = Order.mapInput(Order.String, (fact: InsightsOnOrderFact) => fact.productId);

export const insightsOnOrderFacts = (
  openOrderLines: Iterable<InsightsOpenOrderLine>,
): ReadonlyArray<InsightsOnOrderFact> => {
  const units = new Map<string, number>();
  for (const line of openOrderLines) {
    const remaining = purchaseOrderLineRemaining(line);
    if (remaining > 0) units.set(line.productId, (units.get(line.productId) ?? 0) + remaining);
  }
  return [...units].map(([productId, total]) => ({ productId, units: total })).sort(byProductId);
};
