import {
  SALES_RANGE_DAYS,
  type AbcClass,
  type ExpiringBatch,
  type InsightAlert,
  type InsightSeverity,
  type InsightsInventoryTotals,
  type InsightsSalesSummary,
  type OrderSuggestion,
  type ProductInsight,
  type SalesDay,
  type SalesPeriod,
  type SalesRange,
  type StockPolicy,
  type StockStatus,
  type StockStatusCounts,
  type TopProduct,
} from "@store/contracts/sync/replica-analytics";
import {
  INSIGHTS_DAY_MILLIS,
  insightsDayOf,
  insightsDayStart,
  type InsightsBatchFact,
  type InsightsOnOrderFact,
  type InsightsProductFact,
  type ReplicaInsightsFacts,
} from "@store/contracts/sync/replica-insights";

import { formatPrice } from "../format";
import { forecastDemand, type DemandTrend } from "./demand";
import { serviceLevelFor } from "./policy";
import { inverseNormal } from "./statistics";

const DEMAND_HISTORY_DAYS = 90;
const INSIGHTS_HISTORY_DAYS = 2 * DEMAND_HISTORY_DAYS;

export const ATTENTION_STATUSES: ReadonlySet<StockStatus> = new Set(["out", "critical", "low"]);

export type InsightsReport = {
  readonly generatedAt: number;
  readonly today: number;
  readonly utcOffsetMinutes: number;
  readonly policy: StockPolicy;
  readonly products: ReadonlyArray<ProductInsight>;
  readonly counts: StockStatusCounts;
  readonly alerts: ReadonlyArray<InsightAlert>;
  readonly expiring: ReadonlyArray<ExpiringBatch>;
  readonly inventory: InsightsInventoryTotals;
  readonly sales: InsightsSalesSummary;
  readonly truncated: boolean;
};

export type SalesLedger = {
  readonly series: Float64Array;
  units30d: number;
  units90d: number;
  revenue90d: number;
  lastSoldDay: number | null;
  readonly periodRevenue: Float64Array;
  readonly periodUnits: Float64Array;
  readonly previousRevenue: Float64Array;
  readonly previousUnits: Float64Array;
};

const STATUS_WEIGHT = {
  out: 100,
  critical: 80,
  low: 50,
  dead: 20,
  overstock: 10,
  healthy: 0,
  inactive: 0,
} satisfies Record<StockStatus, number>;
const ABC_WEIGHT = { A: 3, B: 2, C: 1 } satisfies Record<AbcClass, number>;
export const MAX_ALERTS = 60;
const ALERT_SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  positive: 2,
  info: 3,
} satisfies Record<InsightSeverity, number>;

export const emptyLedger = (): SalesLedger => ({
  series: new Float64Array(DEMAND_HISTORY_DAYS),
  units30d: 0,
  units90d: 0,
  revenue90d: 0,
  lastSoldDay: null,
  periodRevenue: new Float64Array(SALES_RANGE_DAYS.length),
  periodUnits: new Float64Array(SALES_RANGE_DAYS.length),
  previousRevenue: new Float64Array(SALES_RANGE_DAYS.length),
  previousUnits: new Float64Array(SALES_RANGE_DAYS.length),
});

export const addSaleToLedger = (
  ledger: SalesLedger,
  sale: { readonly day: number; readonly units: number; readonly revenue: number },
  today: number,
) => {
  const age = today - sale.day;
  if (age < 0) return;
  if (age >= 1 && age <= DEMAND_HISTORY_DAYS) {
    const index = DEMAND_HISTORY_DAYS - age;
    ledger.series[index] = (ledger.series[index] ?? 0) + sale.units;
  }
  if (age < DEMAND_HISTORY_DAYS) {
    ledger.units90d += sale.units;
    ledger.revenue90d += sale.revenue;
    if (age < 30) ledger.units30d += sale.units;
  }
  if (sale.units > 0 && (ledger.lastSoldDay === null || sale.day > ledger.lastSoldDay)) {
    ledger.lastSoldDay = sale.day;
  }
  SALES_RANGE_DAYS.forEach((range, slot) => {
    if (age < range) {
      ledger.periodRevenue[slot] = (ledger.periodRevenue[slot] ?? 0) + sale.revenue;
      ledger.periodUnits[slot] = (ledger.periodUnits[slot] ?? 0) + sale.units;
    } else if (age < 2 * range) {
      ledger.previousRevenue[slot] = (ledger.previousRevenue[slot] ?? 0) + sale.revenue;
      ledger.previousUnits[slot] = (ledger.previousUnits[slot] ?? 0) + sale.units;
    }
  });
};

const buildLedgers = (facts: ReplicaInsightsFacts, today: number) => {
  const ledgers = new Map<string, SalesLedger>();
  for (const sale of facts.sales) {
    if (today - sale.day < 0) continue;
    let ledger = ledgers.get(sale.productId);
    if (ledger === undefined) {
      ledger = emptyLedger();
      ledgers.set(sale.productId, ledger);
    }
    addSaleToLedger(ledger, sale, today);
  }
  return ledgers;
};

export const classifyRevenueRanking = (
  ranked: Iterable<{ readonly id: string; readonly revenue: number }>,
  emit: (id: string, abc: AbcClass) => void,
) => {
  let total = 0;
  const entries = [...ranked];
  for (const entry of entries) total += entry.revenue;
  let cumulative = 0;
  for (const entry of entries) {
    const shareBefore = total === 0 ? 1 : cumulative / total;
    emit(entry.id, shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C");
    cumulative += entry.revenue;
  }
};

const classifyAbc = (
  products: ReadonlyArray<InsightsProductFact>,
  ledgers: Map<string, SalesLedger>,
) => {
  const ranked = products
    .map((product) => ({ id: product.id, revenue: ledgers.get(product.id)?.revenue90d ?? 0 }))
    .filter((entry) => entry.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue);
  const classes = new Map<string, AbcClass>();
  classifyRevenueRanking(ranked, (id, abc) => classes.set(id, abc));
  return classes;
};

export const onOrderLookup = (facts: Iterable<InsightsOnOrderFact>) => {
  const units = new Map<string, number>();
  for (const fact of facts)
    units.set(fact.productId, (units.get(fact.productId) ?? 0) + fact.units);
  return (productId: string) => units.get(productId) ?? 0;
};

const unitCostOf = (product: InsightsProductFact) =>
  product.purchasePrice === null ? null : product.purchasePrice / product.unitsPerPack;

const unitPriceOf = (product: InsightsProductFact, ledger: SalesLedger | undefined) =>
  product.unitPrice ??
  (product.retailPrice === null ? null : product.retailPrice / product.unitsPerPack) ??
  (ledger && ledger.units90d > 0 ? ledger.revenue90d / ledger.units90d : null);

type StockPosition = {
  readonly onHandUnits: number;
  readonly availableUnits: number;
  readonly expiredUnits: number;
  readonly expiryRiskUnits: number;
  readonly nearestExpiry: number | null;
  readonly expiring: ReadonlyArray<Omit<ExpiringBatch, "name" | "valueAtCost">>;
};

const fefoStockPosition = (
  product: InsightsProductFact,
  batches: ReadonlyArray<InsightsBatchFact>,
  dailyRate: number,
  policy: StockPolicy,
  now: number,
): StockPosition => {
  const horizon =
    now +
    Math.max(policy.expiryWarningDays, policy.leadDays + policy.coverDays) * INSIGHTS_DAY_MILLIS;
  const warning = now + policy.expiryWarningDays * INSIGHTS_DAY_MILLIS;
  const ordered = [...batches].sort(
    (left, right) => (left.expiresAt ?? Infinity) - (right.expiresAt ?? Infinity),
  );
  let onHandUnits = 0;
  let availableUnits = 0;
  let expiredUnits = 0;
  let expiryRiskUnits = 0;
  let fefoAllocatedUnits = 0;
  let nearestExpiry: number | null = null;
  const expiring: Array<Omit<ExpiringBatch, "name" | "valueAtCost">> = [];
  for (const batch of ordered) {
    const units = Math.max(0, batch.packQuantity * product.unitsPerPack + batch.unitQuantity);
    if (units === 0) continue;
    onHandUnits += units;
    if (batch.expiresAt !== null && batch.expiresAt <= now) {
      expiredUnits += units;
      continue;
    }
    availableUnits += units;
    if (batch.expiresAt === null) continue;
    nearestExpiry =
      nearestExpiry === null ? batch.expiresAt : Math.min(nearestExpiry, batch.expiresAt);
    let atRisk = 0;
    if (batch.expiresAt <= horizon) {
      const sellableBeforeExpiry =
        (dailyRate * (batch.expiresAt - now)) / INSIGHTS_DAY_MILLIS - fefoAllocatedUnits;
      const sellable = Math.min(units, Math.max(0, sellableBeforeExpiry));
      atRisk = Math.floor(units - sellable);
      fefoAllocatedUnits += sellable;
      expiryRiskUnits += atRisk;
    } else {
      fefoAllocatedUnits += units;
    }
    if (batch.expiresAt <= warning) {
      expiring.push({
        productId: product.id,
        batchNumber: batch.batchNumber,
        expiresAt: batch.expiresAt,
        units,
        atRiskUnits: atRisk,
      });
    }
  }
  return { onHandUnits, availableUnits, expiredUnits, expiryRiskUnits, nearestExpiry, expiring };
};

const orderFor = (
  product: InsightsProductFact,
  shortfallUnits: number,
  onOrderUnits: number,
  unitCost: number | null,
): OrderSuggestion | null => {
  const units = shortfallUnits - onOrderUnits;
  if (units <= 0) return null;
  const packSize = product.tracksPacks ? product.unitsPerPack : 1;
  const quantity = Math.ceil(units / packSize);
  const baseUnits = quantity * packSize;
  return {
    quantity,
    unit: product.tracksPacks ? "packs" : "units",
    baseUnits,
    cost: unitCost === null ? null : Math.round(baseUnits * unitCost),
  };
};

type AnalyzedProduct = {
  readonly insight: ProductInsight;
  readonly expiring: ReadonlyArray<ExpiringBatch>;
};

export const analyzeProduct = (input: {
  readonly product: InsightsProductFact;
  readonly batches: ReadonlyArray<InsightsBatchFact>;
  readonly onOrderUnits: number;
  readonly ledger: SalesLedger | undefined;
  readonly abc: AbcClass;
  readonly policy: StockPolicy;
  readonly now: number;
  readonly today: number;
  readonly utcOffsetMinutes: number;
}): AnalyzedProduct => {
  const { product, ledger, policy, now, today, onOrderUnits } = input;
  const createdDay = insightsDayOf(product.createdAt, input.utcOffsetMinutes);
  const observedDays = Math.max(0, Math.min(DEMAND_HISTORY_DAYS, today - createdDay));
  const series = (ledger?.series ?? new Float64Array(DEMAND_HISTORY_DAYS)).subarray(
    DEMAND_HISTORY_DAYS - observedDays,
  );
  const demand = forecastDemand(series);
  const rate = demand.dailyRate;
  const position = fefoStockPosition(product, input.batches, rate, policy, now);
  const usableUnits = Math.max(0, position.availableUnits - position.expiryRiskUnits);
  const z = inverseNormal(serviceLevelFor(policy, input.abc));
  const lead = Math.max(1, policy.leadDays);
  const cycle = lead + policy.coverDays;
  const safetyStock = rate > 0 ? Math.ceil(z * demand.dailyDeviation * Math.sqrt(lead)) : 0;
  const coveredForCycle = rate > 0 && usableUnits / rate >= cycle;
  const floor = coveredForCycle ? 0 : policy.minimumUnits;
  const reorderPoint = Math.max(floor, Math.ceil(rate * lead) + safetyStock);
  const orderUpTo = Math.max(
    reorderPoint,
    Math.ceil(rate * cycle + (rate > 0 ? z * demand.dailyDeviation * Math.sqrt(cycle) : 0)),
  );
  const daysOfCover = rate > 0 ? usableUnits / rate : null;
  const lastSoldDay = ledger?.lastSoldDay ?? null;
  const daysSinceLastSale = lastSoldDay === null ? null : today - lastSoldDay;
  const ageDays = today - createdDay;
  const soldRecently = (ledger?.units90d ?? 0) > 0;
  const dead =
    position.availableUnits > 0 &&
    ageDays >= policy.deadStockDays &&
    (daysSinceLastSale === null || daysSinceLastSale >= policy.deadStockDays);
  const status: StockStatus =
    position.availableUnits === 0
      ? rate > 0 || soldRecently
        ? "out"
        : "inactive"
      : daysOfCover !== null && daysOfCover < policy.leadDays
        ? "critical"
        : dead
          ? "dead"
          : usableUnits <= reorderPoint
            ? "low"
            : daysOfCover !== null && daysOfCover > policy.overstockDays
              ? "overstock"
              : "healthy";
  const unitCost = unitCostOf(product);
  const unitPrice = unitPriceOf(product, ledger);
  const needsStock = status === "out" || status === "critical" || status === "low";
  const order =
    needsStock && rate > 0
      ? orderFor(product, orderUpTo - usableUnits, onOrderUnits, unitCost)
      : null;
  const lostRevenuePerDay =
    (status === "out" || status === "critical") && unitPrice !== null ? rate * unitPrice : 0;
  const stockValueAtCost =
    unitCost === null ? null : Math.round(position.availableUnits * unitCost);
  const stockValueAtRetail =
    unitPrice === null ? null : Math.round(position.availableUnits * unitPrice);
  const impact =
    lostRevenuePerDay * lead +
    (status === "dead" || status === "overstock" ? (stockValueAtCost ?? 0) * 0.1 : 0);
  const insight: ProductInsight = {
    productId: product.id,
    name: product.name,
    categoryName: product.categoryName,
    unitsPerPack: product.unitsPerPack,
    tracksPacks: product.tracksPacks,
    abc: input.abc,
    status,
    demand,
    onHandUnits: position.onHandUnits,
    availableUnits: position.availableUnits,
    expiredUnits: position.expiredUnits,
    expiryRiskUnits: position.expiryRiskUnits,
    usableUnits,
    nearestExpiry: position.nearestExpiry,
    daysOfCover,
    stockoutAt: daysOfCover === null ? null : now + Math.floor(daysOfCover) * INSIGHTS_DAY_MILLIS,
    safetyStock,
    reorderPoint,
    orderUpTo,
    onOrderUnits,
    order,
    unitCost,
    unitPrice,
    stockValueAtCost,
    stockValueAtRetail,
    units30d: ledger?.units30d ?? 0,
    units90d: ledger?.units90d ?? 0,
    revenue90d: ledger?.revenue90d ?? 0,
    daysSinceLastSale,
    lostRevenuePerDay,
    priority: STATUS_WEIGHT[status] * ABC_WEIGHT[input.abc] + Math.log10(1 + impact),
  };
  return {
    insight,
    expiring: position.expiring.map((batch) => ({
      ...batch,
      name: product.name,
      valueAtCost: unitCost === null ? null : Math.round(batch.atRiskUnits * unitCost),
    })),
  };
};

const change = (current: number, previous: number) =>
  previous === 0 ? null : current / previous - 1;

type DayFact = ReplicaInsightsFacts["days"][number];
type HourFact = ReplicaInsightsFacts["hours"][number];

export const salesPeriodSeries = (input: {
  readonly days: ReadonlyArray<DayFact>;
  readonly range: SalesRange;
  readonly today: number;
  readonly utcOffsetMinutes: number;
}) => {
  const { range, today } = input;
  const byDay = new Map(input.days.map((day) => [day.day, day]));
  const series: Array<SalesDay> = [];
  let revenue = 0;
  let invoices = 0;
  let previousRevenue = 0;
  let previousInvoices = 0;
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const day = today - offset;
    const current = byDay.get(day);
    const previous = byDay.get(day - range);
    revenue += current?.revenue ?? 0;
    invoices += current?.invoices ?? 0;
    previousRevenue += previous?.revenue ?? 0;
    previousInvoices += previous?.invoices ?? 0;
    series.push({
      day,
      date: insightsDayStart(day, input.utcOffsetMinutes),
      revenue: current?.revenue ?? 0,
      invoices: current?.invoices ?? 0,
      previousRevenue: previous?.revenue ?? 0,
    });
  }
  return { series, revenue, invoices, previousRevenue, previousInvoices };
};

const TOP_PRODUCT_LIMIT = 8;

type PeriodProductEntry = {
  readonly productId: string;
  readonly name: string;
  readonly revenue: number;
  readonly units: number;
  readonly unitCost: number | null;
  readonly trend: DemandTrend;
};

export const summarizePeriodProducts = (entries: Iterable<PeriodProductEntry>) => {
  let productRevenue = 0;
  let costedRevenue = 0;
  let cost = 0;
  const top: Array<PeriodProductEntry> = [];
  for (const entry of entries) {
    if (entry.revenue <= 0 && entry.units <= 0) continue;
    productRevenue += entry.revenue;
    if (entry.unitCost !== null) {
      costedRevenue += entry.revenue;
      cost += entry.units * entry.unitCost;
    }
    let position = top.length;
    for (let index = 0; index < top.length; index += 1) {
      if (entry.revenue > (top[index]?.revenue ?? 0)) {
        position = index;
        break;
      }
    }
    if (position < TOP_PRODUCT_LIMIT) {
      top.splice(position, 0, entry);
      if (top.length > TOP_PRODUCT_LIMIT) top.pop();
    }
  }
  return { productRevenue, costedRevenue, cost, top };
};

export const assembleSalesPeriod = (input: {
  readonly range: SalesRange;
  readonly days: ReturnType<typeof salesPeriodSeries>;
  readonly products: ReturnType<typeof summarizePeriodProducts>;
}): SalesPeriod => {
  const { range } = input;
  const { series, revenue, invoices, previousRevenue, previousInvoices } = input.days;
  const { productRevenue, costedRevenue, cost } = input.products;
  const topProducts: ReadonlyArray<TopProduct> = input.products.top.map((entry) => ({
    productId: entry.productId,
    name: entry.name,
    revenue: entry.revenue,
    units: entry.units,
    share: productRevenue === 0 ? 0 : entry.revenue / productRevenue,
    trend: entry.trend,
  }));
  const costCoverage = productRevenue === 0 ? 0 : costedRevenue / productRevenue;
  const grossProfit = costedRevenue === 0 ? null : Math.round(costedRevenue - cost);
  return {
    days: range,
    revenue,
    invoices,
    averageBasket: invoices === 0 ? null : Math.round(revenue / invoices),
    grossProfit,
    margin: grossProfit === null ? null : grossProfit / costedRevenue,
    costCoverage,
    previousRevenue,
    previousInvoices,
    revenueChange: change(revenue, previousRevenue),
    invoicesChange: change(invoices, previousInvoices),
    series,
    topProducts,
  };
};

const salesPeriod = (input: {
  readonly facts: ReplicaInsightsFacts;
  readonly range: SalesRange;
  readonly slot: number;
  readonly today: number;
  readonly products: ReadonlyArray<InsightsProductFact>;
  readonly ledgers: Map<string, SalesLedger>;
  readonly insights: Map<string, ProductInsight>;
}): SalesPeriod => {
  const { range, slot } = input;
  const entries = function* (): Generator<PeriodProductEntry> {
    for (const product of input.products) {
      const ledger = input.ledgers.get(product.id);
      yield {
        productId: product.id,
        name: product.name,
        revenue: ledger?.periodRevenue[slot] ?? 0,
        units: ledger?.periodUnits[slot] ?? 0,
        unitCost: unitCostOf(product),
        trend: input.insights.get(product.id)?.demand.trend ?? "unknown",
      };
    }
  };
  return assembleSalesPeriod({
    range,
    days: salesPeriodSeries({
      days: input.facts.days,
      range,
      today: input.today,
      utcOffsetMinutes: input.facts.window.utcOffsetMinutes,
    }),
    products: summarizePeriodProducts(entries()),
  });
};

export const salesRhythm = (input: {
  readonly days: ReadonlyArray<DayFact>;
  readonly hours: ReadonlyArray<HourFact>;
  readonly today: number;
}): Omit<InsightsSalesSummary, "periods"> => {
  const { today } = input;
  const weekdayTotals = new Float64Array(7);
  const weekdayCounts = new Float64Array(7);
  for (let age = 1; age <= 56; age += 1) {
    const weekday = (((today - age + 4) % 7) + 7) % 7;
    weekdayCounts[weekday] = (weekdayCounts[weekday] ?? 0) + 1;
  }
  for (const day of input.days) {
    const age = today - day.day;
    if (age < 1 || age > 56) continue;
    const weekday = (((day.day + 4) % 7) + 7) % 7;
    weekdayTotals[weekday] = (weekdayTotals[weekday] ?? 0) + day.revenue;
  }
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    invoices: input.hours.find((fact) => fact.hour === hour)?.invoices ?? 0,
  }));
  const peak = hours.reduce<{ hour: number; invoices: number } | null>(
    (best, entry) => (entry.invoices > (best?.invoices ?? 0) ? entry : best),
    null,
  );
  const todayFact = input.days.find((day) => day.day === today);
  return {
    today: { revenue: todayFact?.revenue ?? 0, invoices: todayFact?.invoices ?? 0 },
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      revenue:
        (weekdayCounts[weekday] ?? 0) === 0
          ? 0
          : (weekdayTotals[weekday] ?? 0) / (weekdayCounts[weekday] ?? 1),
    })),
    hours,
    peakHour: peak?.hour ?? null,
  };
};

const unitsLabel = (units: number) =>
  `${Math.round(units).toLocaleString()} ${units === 1 ? "unit" : "units"}`;

const orderLabel = (order: OrderSuggestion) =>
  `${order.quantity.toLocaleString()} ${order.unit === "packs" ? (order.quantity === 1 ? "pack" : "packs") : order.quantity === 1 ? "unit" : "units"}`;

export const productAlerts = (
  insight: ProductInsight,
  policy: StockPolicy,
): ReadonlyArray<InsightAlert> => {
  const alerts: Array<InsightAlert> = [];
  const push = (alert: Omit<InsightAlert, "id" | "productId">) =>
    alerts.push({
      ...alert,
      id: `${alert.kind}:${insight.productId}`,
      productId: insight.productId,
    });
  const buy = insight.order
    ? ` Order ${orderLabel(insight.order)}.`
    : insight.onOrderUnits > 0
      ? ` ${unitsLabel(insight.onOrderUnits)} already on order.`
      : "";
  switch (insight.status) {
    case "out":
      push({
        kind: "stockout",
        severity: "critical",
        title: `${insight.name} is out of stock`,
        detail:
          insight.lostRevenuePerDay > 0
            ? `Missing about ${formatPrice(Math.round(insight.lostRevenuePerDay))} in sales a day.${buy}`
            : `It sold ${unitsLabel(insight.units90d)} in the last 90 days.${buy}`,
        impact: insight.lostRevenuePerDay * Math.max(1, policy.leadDays),
      });
      break;
    case "critical":
      push({
        kind: "runningOut",
        severity: "critical",
        title: `${insight.name} runs out in ${Math.max(0, Math.floor(insight.daysOfCover ?? 0))} days`,
        detail: `That is before a ${policy.leadDays}-day delivery could arrive.${buy}`,
        impact:
          insight.lostRevenuePerDay * Math.max(1, policy.leadDays - (insight.daysOfCover ?? 0)),
      });
      break;
    case "low":
      if (insight.order) {
        push({
          kind: "reorder",
          severity: "warning",
          title: `Reorder ${insight.name}`,
          detail: `${unitsLabel(insight.usableUnits)} left, below the reorder point of ${insight.reorderPoint}.${buy}`,
          impact: (insight.unitPrice ?? 0) * insight.demand.dailyRate,
        });
      }
      break;
    case "dead":
      if ((insight.stockValueAtCost ?? 0) > 0 || insight.availableUnits > 0) {
        push({
          kind: "deadStock",
          severity: "info",
          title: `${insight.name} hasn't sold in ${insight.daysSinceLastSale ?? policy.deadStockDays}+ days`,
          detail:
            insight.stockValueAtCost === null
              ? `${unitsLabel(insight.availableUnits)} sitting on the shelf.`
              : `${formatPrice(insight.stockValueAtCost)} tied up in ${unitsLabel(insight.availableUnits)}.`,
          impact: (insight.stockValueAtCost ?? 0) * 0.2,
        });
      }
      break;
    case "overstock":
      push({
        kind: "overstock",
        severity: "info",
        title: `${insight.name} is overstocked`,
        detail: `About ${Math.round(insight.daysOfCover ?? 0)} days of stock at the current pace.`,
        impact: (insight.stockValueAtCost ?? 0) * 0.05,
      });
      break;
    case "healthy":
    case "inactive":
      break;
  }
  if (insight.expiredUnits > 0) {
    push({
      kind: "expired",
      severity: "warning",
      title: `${unitsLabel(insight.expiredUnits)} of ${insight.name} expired`,
      detail: "Remove them from the shelf and adjust the batch.",
      impact: insight.expiredUnits * (insight.unitCost ?? 0),
    });
  }
  if (insight.expiryRiskUnits > 0) {
    push({
      kind: "expiryRisk",
      severity: "warning",
      title: `${unitsLabel(insight.expiryRiskUnits)} of ${insight.name} may expire unsold`,
      detail:
        insight.unitCost === null
          ? "Consider a discount or moving them to the front."
          : `About ${formatPrice(Math.round(insight.expiryRiskUnits * insight.unitCost))} at cost. Consider a discount.`,
      impact: insight.expiryRiskUnits * (insight.unitCost ?? insight.unitPrice ?? 0),
    });
  }
  if (insight.abc !== "C" && insight.demand.trendRatio !== null) {
    if (insight.demand.trend === "rising") {
      push({
        kind: "risingDemand",
        severity: "positive",
        title: `${insight.name} is selling ${insight.demand.trendRatio.toFixed(1)}× faster`,
        detail: "Compared with the previous six weeks. Plans already use the new pace.",
        impact: insight.revenue90d / DEMAND_HISTORY_DAYS,
      });
    } else if (insight.demand.trend === "falling") {
      push({
        kind: "fallingDemand",
        severity: "info",
        title: `${insight.name} sales slowed by ${Math.round((1 - insight.demand.trendRatio) * 100)}%`,
        detail: "Compared with the previous six weeks. Check price or placement.",
        impact: insight.revenue90d / DEMAND_HISTORY_DAYS / 2,
      });
    }
  }
  return alerts;
};

export const inventoryContribution = (insight: ProductInsight) => ({
  valueAtCost: insight.stockValueAtCost ?? 0,
  valueAtRetail: insight.stockValueAtRetail ?? 0,
  deadStockValue: insight.status === "dead" ? (insight.stockValueAtCost ?? 0) : 0,
  expiryRiskValue:
    insight.unitCost === null ? 0 : Math.round(insight.expiryRiskUnits * insight.unitCost),
  expiredValue: insight.unitCost === null ? 0 : Math.round(insight.expiredUnits * insight.unitCost),
  reorderCount: insight.order ? 1 : 0,
  reorderCost: insight.order ? (insight.order.cost ?? 0) : 0,
  missingCostCount: insight.unitCost === null && insight.units90d > 0 ? 1 : 0,
});

export const missingCostsAlert = (count: number): InsightAlert => ({
  id: "missingCosts",
  kind: "missingCosts",
  severity: "info",
  productId: null,
  title: `Add purchase prices to ${count} selling ${count === 1 ? "product" : "products"}`,
  detail: "Margins, stock value, and order costs leave those products out until then.",
  impact: 0,
});

export const compareAlerts = (left: InsightAlert, right: InsightAlert) =>
  ALERT_SEVERITY_RANK[left.severity] - ALERT_SEVERITY_RANK[right.severity] ||
  right.impact - left.impact ||
  left.title.localeCompare(right.title);

export const analyzeInsights = (
  facts: ReplicaInsightsFacts,
  policy: StockPolicy,
  now: number,
): InsightsReport => {
  const offset = facts.window.utcOffsetMinutes;
  const today = insightsDayOf(now, offset);
  const visible = facts.products.filter((product) => product.visible);
  const ledgers = buildLedgers(facts, today);
  const abc = classifyAbc(visible, ledgers);
  const batchesByProduct = new Map<string, Array<InsightsBatchFact>>();
  for (const batch of facts.batches) {
    const group = batchesByProduct.get(batch.productId);
    if (group) group.push(batch);
    else batchesByProduct.set(batch.productId, [batch]);
  }
  const onOrderOf = onOrderLookup(facts.onOrder);

  const products: Array<ProductInsight> = [];
  const expiring: Array<ExpiringBatch> = [];
  for (const product of visible) {
    const analyzed = analyzeProduct({
      product,
      batches: batchesByProduct.get(product.id) ?? [],
      onOrderUnits: onOrderOf(product.id),
      ledger: ledgers.get(product.id),
      abc: abc.get(product.id) ?? "C",
      policy,
      now,
      today,
      utcOffsetMinutes: offset,
    });
    products.push(analyzed.insight);
    expiring.push(...analyzed.expiring);
  }
  products.sort(
    (left, right) => right.priority - left.priority || left.name.localeCompare(right.name),
  );
  const insightById = new Map(products.map((insight) => [insight.productId, insight]));

  const counts = {
    out: 0,
    critical: 0,
    low: 0,
    dead: 0,
    overstock: 0,
    healthy: 0,
    inactive: 0,
  } satisfies Record<StockStatus, number>;
  const inventory = {
    valueAtCost: 0,
    valueAtRetail: 0,
    deadStockValue: 0,
    expiryRiskValue: 0,
    expiredValue: 0,
    reorderCost: 0,
    reorderCount: 0,
    missingCostCount: 0,
  };
  const alerts: Array<InsightAlert> = [];
  for (const insight of products) {
    counts[insight.status] += 1;
    const share = inventoryContribution(insight);
    inventory.valueAtCost += share.valueAtCost;
    inventory.valueAtRetail += share.valueAtRetail;
    inventory.deadStockValue += share.deadStockValue;
    inventory.expiryRiskValue += share.expiryRiskValue;
    inventory.expiredValue += share.expiredValue;
    inventory.reorderCount += share.reorderCount;
    inventory.reorderCost += share.reorderCost;
    inventory.missingCostCount += share.missingCostCount;
    alerts.push(...productAlerts(insight, policy));
  }
  if (inventory.missingCostCount > 0) alerts.push(missingCostsAlert(inventory.missingCostCount));
  if (facts.truncated) {
    alerts.push({
      id: "truncated",
      kind: "truncated",
      severity: "info",
      productId: null,
      title: "Insights cover part of a very large catalog",
      detail: "The device analyzed the largest bounded slice it can hold at once.",
      impact: 0,
    });
  }
  alerts.sort(compareAlerts);

  const period = (range: SalesRange, slot: number) =>
    salesPeriod({ facts, range, slot, today, products: visible, ledgers, insights: insightById });
  const periods = {
    7: period(7, 0),
    30: period(30, 1),
    90: period(90, 2),
  } satisfies Record<SalesRange, SalesPeriod>;

  const rhythm = salesRhythm({ days: facts.days, hours: facts.hours, today });

  return {
    generatedAt: now,
    today,
    utcOffsetMinutes: offset,
    policy,
    products,
    counts,
    alerts: alerts.slice(0, MAX_ALERTS),
    expiring: expiring.sort((left, right) => left.expiresAt - right.expiresAt),
    inventory,
    sales: { ...rhythm, periods },
    truncated: facts.truncated,
  };
};

export const insightsWindowFor = (now: number, utcOffsetMinutes: number) => {
  const today = insightsDayOf(now, utcOffsetMinutes);
  return {
    since: insightsDayStart(today - INSIGHTS_HISTORY_DAYS + 1, utcOffsetMinutes),
    until: insightsDayStart(today + 1, utcOffsetMinutes),
    utcOffsetMinutes,
  };
};
