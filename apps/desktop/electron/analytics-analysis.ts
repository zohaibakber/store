import type { ProductAnalysis, SummaryReader } from "@store/client-db/node-analytics";
import type {
  InsightsBatchFact,
  InsightsProductFact,
  InsightsSummary,
  AnalyticsRun,
  StockPolicy,
} from "@store/contracts";
import { SUMMARY_ATTENTION_LIMIT, SUMMARY_EXPIRING_LIMIT } from "@store/contracts";
import {
  addSaleToLedger,
  analyzeProduct,
  assembleSalesPeriod,
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
} from "@store/services/insights";

export type SaleFact = {
  readonly productId: string;
  readonly day: number;
  readonly units: number;
  readonly revenue: number;
};

export const analyzeProducts = (input: {
  readonly products: ReadonlyArray<InsightsProductFact>;
  readonly batches: ReadonlyArray<InsightsBatchFact>;
  readonly sales: ReadonlyArray<SaleFact>;
  readonly abcOf: (productId: string) => "A" | "B" | "C";
  readonly policy: StockPolicy;
  readonly now: number;
  readonly today: number;
  readonly utcOffsetMinutes: number;
}): ReadonlyArray<ProductAnalysis> => {
  const batchesByProduct = new Map<string, Array<InsightsBatchFact>>();
  for (const batch of input.batches) {
    const group = batchesByProduct.get(batch.productId);
    if (group) group.push(batch);
    else batchesByProduct.set(batch.productId, [batch]);
  }
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
      batches: batchesByProduct.get(product.id) ?? [],
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
