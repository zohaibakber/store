import * as Schema from "effect/Schema";

export const INSIGHTS_DAY_MILLIS = 86_400_000;
export const INSIGHTS_HOUR_MILLIS = 3_600_000;
export const MAX_INSIGHTS_WINDOW_DAYS = 400;
export const MAX_INSIGHTS_PRODUCTS = 20_000;
export const MAX_INSIGHTS_BATCHES = 60_000;
export const MAX_INSIGHTS_SALES = 250_000;

const Integer = Schema.Number.check(Schema.isInt());
const NonNegativeInteger = Integer.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInteger = Integer.check(Schema.isGreaterThanOrEqualTo(1));
const EpochMillis = NonNegativeInteger;

export const ReplicaInsightsWindow = Schema.Struct({
  since: EpochMillis,
  until: EpochMillis,
  utcOffsetMinutes: Integer.check(Schema.isBetween({ minimum: -840, maximum: 840 })),
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
  unitsPerPack: PositiveInteger,
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
  packQuantity: Integer,
  unitQuantity: Integer,
  expiresAt: Schema.NullOr(Schema.Number),
});
export type InsightsBatchFact = typeof InsightsBatchFact.Type;

export const InsightsSaleFact = Schema.Struct({
  productId: Schema.String,
  day: Integer,
  units: Integer,
  revenue: Schema.Number,
});
export type InsightsSaleFact = typeof InsightsSaleFact.Type;

export const InsightsDayFact = Schema.Struct({
  day: Integer,
  invoices: NonNegativeInteger,
  revenue: Schema.Number,
});
export type InsightsDayFact = typeof InsightsDayFact.Type;

export const InsightsHourFact = Schema.Struct({
  hour: Integer.check(Schema.isBetween({ minimum: 0, maximum: 23 })),
  invoices: NonNegativeInteger,
  revenue: Schema.Number,
});
export type InsightsHourFact = typeof InsightsHourFact.Type;

export const ReplicaInsightsFacts = Schema.Struct({
  window: ReplicaInsightsWindow,
  products: Schema.Array(InsightsProductFact),
  batches: Schema.Array(InsightsBatchFact),
  sales: Schema.Array(InsightsSaleFact),
  days: Schema.Array(InsightsDayFact),
  hours: Schema.Array(InsightsHourFact),
  truncated: Schema.Boolean,
});
export type ReplicaInsightsFacts = typeof ReplicaInsightsFacts.Type;

export const insightsDayOf = (epochMillis: number, utcOffsetMinutes: number) =>
  Math.floor((epochMillis + utcOffsetMinutes * 60_000) / INSIGHTS_DAY_MILLIS);

export const insightsHourOf = (epochMillis: number, utcOffsetMinutes: number) => {
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

export type InsightsSalesAccumulator = {
  readonly addInvoice: (
    invoice: InsightsInvoice,
    lines: ReadonlyArray<InsightsInvoiceLine>,
  ) => boolean;
  readonly result: () => {
    readonly sales: ReadonlyArray<InsightsSaleFact>;
    readonly days: ReadonlyArray<InsightsDayFact>;
    readonly hours: ReadonlyArray<InsightsHourFact>;
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
