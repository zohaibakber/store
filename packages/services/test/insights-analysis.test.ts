import type {
  InsightsBatchFact,
  InsightsProductFact,
  InsightsSaleFact,
  ReplicaInsightsFacts,
} from "@store/contracts";
import { describe, expect, it } from "vitest";

import { analyzeInsights, DEFAULT_STOCK_POLICY, insightsWindowFor } from "../src/insights";

const DAY = 86_400_000;
const OFFSET = 300;
const now = Date.UTC(2026, 8, 20, 7);
const today = Math.floor((now + OFFSET * 60_000) / DAY);

const product = (
  id: string,
  overrides: Partial<InsightsProductFact> = {},
): InsightsProductFact => ({
  id,
  name: id,
  categoryId: "cat",
  categoryName: "Tablets",
  tracksPacks: true,
  unitsPerPack: 10,
  purchasePrice: 1_000,
  retailPrice: 1_500,
  unitPrice: null,
  visible: true,
  createdAt: now - 200 * DAY,
  ...overrides,
});

const batch = (
  productId: string,
  units: number,
  expiresInDays: number | null = null,
): InsightsBatchFact => ({
  productId,
  batchNumber: `${productId}-b`,
  packQuantity: 0,
  unitQuantity: units,
  expiresAt: expiresInDays === null ? null : now + expiresInDays * DAY,
});

const dailySales = (productId: string, units: number, days: number, price = 150) =>
  Array.from({ length: days }, (_, age): InsightsSaleFact => ({
    productId,
    day: today - age - 1,
    units,
    revenue: units * price,
  }));

const facts = (input: {
  readonly products: ReadonlyArray<InsightsProductFact>;
  readonly batches: ReadonlyArray<InsightsBatchFact>;
  readonly sales: ReadonlyArray<InsightsSaleFact>;
}): ReplicaInsightsFacts => {
  const byDay = new Map<number, { day: number; invoices: number; revenue: number }>();
  for (const sale of input.sales) {
    const day = byDay.get(sale.day) ?? { day: sale.day, invoices: 0, revenue: 0 };
    day.invoices += 1;
    day.revenue += sale.revenue;
    byDay.set(sale.day, day);
  }
  return {
    window: insightsWindowFor(now, OFFSET),
    products: input.products,
    batches: input.batches,
    sales: input.sales,
    days: [...byDay.values()],
    hours: [{ hour: 18, invoices: 40, revenue: 1 }],
    truncated: false,
  };
};

describe("analyzeInsights", () => {
  const report = analyzeInsights(
    facts({
      products: [
        product("runner"),
        product("empty"),
        product("steady"),
        product("stale"),
        product("expiring", { purchasePrice: null }),
        product("hidden", { visible: false }),
      ],
      batches: [
        batch("runner", 12),
        batch("steady", 400),
        batch("stale", 30),
        batch("expiring", 200, 10),
      ],
      sales: [
        ...dailySales("runner", 6, 90),
        ...dailySales("empty", 4, 90),
        ...dailySales("steady", 2, 90),
        ...dailySales("expiring", 1, 90),
      ],
    }),
    DEFAULT_STOCK_POLICY,
    now,
  );
  const byId = new Map(report.products.map((insight) => [insight.productId, insight]));

  it("excludes hidden products and ranks urgent stock first", () => {
    expect(byId.has("hidden")).toBe(false);
    expect(report.products[0]?.status).toBe("out");
    expect(byId.get("empty")?.status).toBe("out");
    expect(byId.get("runner")?.status).toBe("critical");
    expect(byId.get("stale")?.status).toBe("dead");
  });

  it("does not flag a slow seller whose stock covers a full order cycle", () => {
    const slowSales = Array.from({ length: 18 }, (_, index): InsightsSaleFact => ({
      productId: "slow",
      day: today - 1 - index * 5,
      units: 1,
      revenue: 150,
    }));
    const slow = analyzeInsights(
      facts({ products: [product("slow")], batches: [batch("slow", 9)], sales: slowSales }),
      DEFAULT_STOCK_POLICY,
      now,
    ).products[0];
    expect(slow?.daysOfCover).toBeGreaterThan(28);
    expect(slow?.status).toBe("healthy");
    expect(slow?.order).toBeNull();
  });

  it("sizes orders with service-level safety stock and whole packs", () => {
    const runner = byId.get("runner");
    expect(runner?.demand.dailyRate).toBeCloseTo(6, 0);
    expect(runner?.reorderPoint).toBeGreaterThanOrEqual(42);
    expect(runner?.order?.unit).toBe("packs");
    expect((runner?.order?.baseUnits ?? 0) % 10).toBe(0);
    expect(runner?.order?.baseUnits ?? 0).toBeGreaterThanOrEqual((runner?.orderUpTo ?? 0) - 12);
    expect(runner?.order?.cost).toBe((runner?.order?.quantity ?? 0) * 1_000);
  });

  it("finds units that will expire before they can sell", () => {
    const expiring = byId.get("expiring");
    expect(expiring?.expiryRiskUnits).toBeGreaterThan(180);
    expect(report.expiring[0]?.productId).toBe("expiring");
    expect(report.inventory.missingCostCount).toBe(1);
  });

  it("allocates forecast demand to earlier-expiring batches first", () => {
    const fefo = analyzeInsights(
      facts({
        products: [product("fefo")],
        batches: [batch("fefo", 100, 10), batch("fefo", 100, 20)],
        sales: dailySales("fefo", 2, 90),
      }),
      DEFAULT_STOCK_POLICY,
      now,
    );
    expect(fefo.products[0]?.demand.dailyRate).toBeCloseTo(2, 0);
    expect(fefo.products[0]?.expiryRiskUnits).toBe(160);
    expect(fefo.expiring.map((entry) => entry.atRiskUnits)).toEqual([80, 80]);
  });

  it("classifies revenue with ABC and summarizes sales periods", () => {
    expect(byId.get("runner")?.abc).toBe("A");
    expect(byId.get("steady")?.abc).toBe("A");
    expect(byId.get("expiring")?.abc).toBe("B");
    const week = report.sales.periods[7];
    expect(week.series).toHaveLength(7);
    expect(week.revenue).toBe(6 * (6 + 4 + 2 + 1) * 150);
    expect(week.revenueChange).toBeCloseTo(6 / 7 - 1, 5);
    expect(week.margin).toBeCloseTo(1 / 3, 5);
    expect(week.costCoverage).toBeCloseTo(12 / 13, 5);
    expect(week.topProducts[0]?.productId).toBe("runner");
    expect(report.sales.peakHour).toBe(18);
  });

  it("orders alerts by severity, then money at stake", () => {
    const severities = report.alerts.map((alert) => alert.severity);
    expect(severities[0]).toBe("critical");
    expect(severities.indexOf("info")).toBeGreaterThan(severities.lastIndexOf("critical"));
    expect(report.alerts.some((alert) => alert.kind === "expiryRisk")).toBe(true);
    expect(report.alerts.some((alert) => alert.kind === "deadStock")).toBe(true);
    expect(report.alerts.some((alert) => alert.kind === "missingCosts")).toBe(true);
  });
});
