import type { ProductId } from "@store/contracts/ids";
import {
  SUMMARY_ATTENTION_LIMIT,
  SUMMARY_EXPIRING_LIMIT,
  type AbcClass,
  type AnalyticsRun,
  type ExpiringBatch,
  type InsightAlert,
  type InsightsInventoryTotals,
  type InsightsSummary,
  type ProductInsight,
  type StockPolicy,
  type StockStatusCounts,
} from "@store/contracts/sync/replica-analytics";
import type {
  InsightsBatchFact,
  InsightsOnOrderFact,
  InsightsProductFact,
} from "@store/contracts/sync/replica-insights";
import * as Arr from "effect/Array";

import {
  addSaleToLedger,
  analyzeProduct,
  assembleSalesPeriod,
  classifyRevenueRanking,
  compareAlerts,
  emptyLedger,
  inventoryContribution,
  MAX_ALERTS,
  missingCostsAlert,
  productAlerts,
  salesPeriodSeries,
  salesRhythm,
  summarizePeriodProducts,
  type SalesLedger,
} from "./analysis";

export const RANKING_DAYS = 90;

export type ProductContribution = {
  readonly valueAtCost: number;
  readonly valueAtRetail: number;
  readonly deadStockValue: number;
  readonly expiryRiskValue: number;
  readonly expiredValue: number;
  readonly reorderCost: number;
  readonly missingCostCount: number;
};

export type ProductAnalysis = {
  readonly insight: ProductInsight;
  readonly alerts: ReadonlyArray<InsightAlert>;
  readonly expiring: ReadonlyArray<ExpiringBatch>;
  readonly periodRevenue: readonly [number, number, number];
  readonly periodUnits: readonly [number, number, number];
  readonly contribution: ProductContribution;
};

type PeriodProductRow = {
  readonly productId: ProductId;
  readonly name: string;
  readonly revenue: number;
  readonly units: number;
  readonly unitCost: number | null;
  readonly trend: ProductInsight["demand"]["trend"];
};

export type SummaryReader = {
  readonly runId: number;
  readonly productCount: () => number;
  readonly statusCounts: () => StockStatusCounts;
  readonly inventory: () => InsightsInventoryTotals;
  readonly alertCandidates: (limit: number) => ReadonlyArray<InsightAlert>;
  readonly attention: (limit: number) => {
    readonly rows: ReadonlyArray<ProductInsight>;
    readonly count: number;
  };
  readonly expiring: (limit: number) => {
    readonly rows: ReadonlyArray<ExpiringBatch>;
    readonly count: number;
  };
  readonly periodProducts: (slot: 0 | 1 | 2) => Iterable<PeriodProductRow>;
};

type SaleFact = {
  readonly productId: string;
  readonly day: number;
  readonly units: number;
  readonly revenue: number;
};

export type StoredRanking = {
  readonly productId: string;
  readonly abc: string;
  readonly revenue90d: number;
};

export const groupBatchesByProduct = (batches: ReadonlyArray<InsightsBatchFact>) =>
  Arr.groupBy(batches, (batch) => batch.productId);

export const abcLookup = (map: ReadonlyMap<string, AbcClass>) => (id: string) => map.get(id) ?? "C";

export const analyzeProducts = (input: {
  readonly products: ReadonlyArray<InsightsProductFact>;
  readonly batches: ReadonlyArray<InsightsBatchFact>;
  readonly sales: ReadonlyArray<SaleFact>;
  readonly onOrderOf: (productId: string) => number;
  readonly abcOf: (productId: string) => AbcClass;
  readonly policy: StockPolicy;
  readonly now: number;
  readonly today: number;
  readonly utcOffsetMinutes: number;
}): ReadonlyArray<ProductAnalysis> => {
  const batchesByProduct = groupBatchesByProduct(input.batches);
  const ledgers = new Map<string, SalesLedger>();
  for (const sale of input.sales) {
    if (input.today - sale.day < 0) continue;
    let ledger = ledgers.get(sale.productId);
    if (ledger === undefined) {
      ledger = emptyLedger();
      ledgers.set(sale.productId, ledger);
    }
    addSaleToLedger(ledger, sale, input.today);
  }
  return input.products.map((product) => {
    const ledger = ledgers.get(product.id);
    const analyzed = analyzeProduct({
      product,
      batches: batchesByProduct[product.id] ?? [],
      onOrderUnits: input.onOrderOf(product.id),
      ledger,
      abc: input.abcOf(product.id),
      policy: input.policy,
      now: input.now,
      today: input.today,
      utcOffsetMinutes: input.utcOffsetMinutes,
    });
    const share = inventoryContribution(analyzed.insight);
    return {
      insight: analyzed.insight,
      alerts: productAlerts(analyzed.insight, input.policy),
      expiring: analyzed.expiring,
      periodRevenue: [
        ledger?.periodRevenue[0] ?? 0,
        ledger?.periodRevenue[1] ?? 0,
        ledger?.periodRevenue[2] ?? 0,
      ],
      periodUnits: [
        ledger?.periodUnits[0] ?? 0,
        ledger?.periodUnits[1] ?? 0,
        ledger?.periodUnits[2] ?? 0,
      ],
      contribution: {
        valueAtCost: share.valueAtCost,
        valueAtRetail: share.valueAtRetail,
        deadStockValue: share.deadStockValue,
        expiryRiskValue: share.expiryRiskValue,
        expiredValue: share.expiredValue,
        reorderCost: share.reorderCost,
        missingCostCount: share.missingCostCount,
      },
    };
  });
};

export const onOrderChanges = (
  stored: ReadonlyArray<InsightsOnOrderFact>,
  current: ReadonlyArray<InsightsOnOrderFact>,
): ReadonlyArray<string> => {
  const before = new Map(stored.map((fact) => [fact.productId, fact.units]));
  const changed: Array<string> = [];
  for (const fact of current) {
    if (before.get(fact.productId) !== fact.units) changed.push(fact.productId);
    before.delete(fact.productId);
  }
  return [...changed, ...before.keys()];
};

export type Reclassification = {
  readonly abc: ReadonlyMap<string, AbcClass>;
  readonly flipped: ReadonlyArray<string>;
};

export const reclassifyAffected = (input: {
  readonly stored: ReadonlyArray<StoredRanking>;
  readonly affected: ReadonlySet<string>;
  readonly visibleAffected: ReadonlySet<string>;
  readonly sales: ReadonlyArray<SaleFact>;
  readonly today: number;
}): Reclassification => {
  const { stored, affected, visibleAffected, today } = input;
  const revenueOf = new Map<string, number>();
  for (const sale of input.sales) {
    if (today - sale.day < 0 || today - sale.day >= RANKING_DAYS) continue;
    revenueOf.set(sale.productId, (revenueOf.get(sale.productId) ?? 0) + sale.revenue);
  }
  const ranking = [
    ...stored
      .filter((entry) => !affected.has(entry.productId) && entry.revenue90d > 0)
      .map((entry) => ({ id: entry.productId, revenue: entry.revenue90d })),
    ...[...revenueOf]
      .filter(([id, revenue]) => visibleAffected.has(id) && revenue > 0)
      .map(([id, revenue]) => ({ id, revenue })),
  ].sort((left, right) => right.revenue - left.revenue || (left.id < right.id ? -1 : 1));
  const abc = new Map<string, AbcClass>();
  classifyRevenueRanking(ranking, (id, klass) => abc.set(id, klass));
  const flipped = stored
    .filter(
      (entry) => !affected.has(entry.productId) && (abc.get(entry.productId) ?? "C") !== entry.abc,
    )
    .map((entry) => entry.productId);
  return { abc, flipped };
};

export const summarizeRun = (input: {
  readonly reader: SummaryReader;
  readonly run: AnalyticsRun;
  readonly policy: StockPolicy;
  readonly now: number;
  readonly days: ReadonlyArray<{
    readonly day: number;
    readonly invoices: number;
    readonly revenue: number;
  }>;
  readonly hours: ReadonlyArray<{
    readonly hour: number;
    readonly invoices: number;
    readonly revenue: number;
  }>;
}): InsightsSummary => {
  const { reader, run } = input;
  const today = run.today;
  const utcOffsetMinutes = run.utcOffsetMinutes;
  const period = (range: 7 | 30 | 90, slot: 0 | 1 | 2) =>
    assembleSalesPeriod({
      range,
      days: salesPeriodSeries({ days: input.days, range, today, utcOffsetMinutes }),
      products: summarizePeriodProducts(reader.periodProducts(slot)),
    });
  const inventory = reader.inventory();
  const alerts = [...reader.alertCandidates(MAX_ALERTS)];
  if (inventory.missingCostCount > 0) alerts.push(missingCostsAlert(inventory.missingCostCount));
  alerts.sort(compareAlerts);
  const attention = reader.attention(SUMMARY_ATTENTION_LIMIT);
  const expiring = reader.expiring(SUMMARY_EXPIRING_LIMIT);
  return {
    run,
    generatedAt: input.now,
    today,
    utcOffsetMinutes,
    policy: input.policy,
    productCount: run.productCount,
    counts: reader.statusCounts(),
    alerts: alerts.slice(0, MAX_ALERTS),
    attention: attention.rows,
    attentionCount: attention.count,
    expiring: expiring.rows,
    expiringCount: expiring.count,
    inventory,
    sales: {
      ...salesRhythm({ days: input.days, hours: input.hours, today }),
      periods: { 7: period(7, 0), 30: period(30, 1), 90: period(90, 2) },
    },
  };
};
