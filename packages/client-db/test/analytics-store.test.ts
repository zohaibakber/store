import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  makeAnalyticsStore,
  openAnalyticsDatabase,
  openInventorySource,
  type ProductAnalysis,
} from "@store/client-db/node-analytics";
import {
  INSIGHTS_DAY_MILLIS,
  type AnalyticsRun,
  type InsightsSummary,
  type ProductInsight,
  type SalesPeriod,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";

const policy = {
  leadDays: 7,
  coverDays: 21,
  serviceLevel: 0.95,
  minimumUnits: 10,
  expiryWarningDays: 60,
  deadStockDays: 60,
  overstockDays: 150,
};

const insight = (
  id: string,
  status: ProductInsight["status"],
  priority: number,
): ProductInsight => ({
  productId: id,
  name: `Product ${id}`,
  categoryName: null,
  unitsPerPack: 1,
  tracksPacks: false,
  abc: "C",
  status,
  demand: {
    dailyRate: 1,
    dailyDeviation: 1,
    pattern: "smooth",
    method: "ses",
    confidence: "high",
    trend: "steady",
    trendRatio: null,
    observedDays: 90,
    sellingDays: 40,
    meanAbsoluteError: 1,
  },
  onHandUnits: 0,
  availableUnits: 0,
  expiredUnits: 0,
  expiryRiskUnits: 0,
  usableUnits: 0,
  nearestExpiry: null,
  daysOfCover: null,
  stockoutAt: null,
  safetyStock: 0,
  reorderPoint: 0,
  orderUpTo: 0,
  order: null,
  unitCost: null,
  unitPrice: null,
  stockValueAtCost: null,
  stockValueAtRetail: null,
  units30d: 0,
  units90d: 0,
  revenue90d: 0,
  daysSinceLastSale: null,
  lostRevenuePerDay: 0,
  priority,
});

const analysis = (
  id: string,
  status: ProductInsight["status"],
  priority: number,
): ProductAnalysis => ({
  insight: insight(id, status, priority),
  alerts: [],
  expiring: [],
  periodRevenue: [0, 0, 0],
  periodUnits: [0, 0, 0],
  contribution: {
    valueAtCost: 0,
    valueAtRetail: 0,
    deadStockValue: 0,
    expiryRiskValue: 0,
    expiredValue: 0,
    reorderCost: 0,
    missingCostCount: 0,
  },
});

const period = (days: 7 | 30 | 90): SalesPeriod => ({
  days,
  revenue: 0,
  invoices: 0,
  averageBasket: null,
  grossProfit: null,
  margin: null,
  costCoverage: 0,
  previousRevenue: 0,
  previousInvoices: 0,
  revenueChange: null,
  invoicesChange: null,
  series: [],
  topProducts: [],
});

const summaryFor = (run: AnalyticsRun, productCount: number): InsightsSummary => ({
  run,
  generatedAt: run.generatedAt,
  today: run.today,
  utcOffsetMinutes: run.utcOffsetMinutes,
  policy,
  productCount,
  counts: {
    out: productCount,
    critical: 0,
    low: 0,
    dead: 0,
    overstock: 0,
    healthy: 0,
    inactive: 0,
  },
  alerts: [],
  attention: [],
  attentionCount: 0,
  expiring: [],
  expiringCount: 0,
  inventory: {
    valueAtCost: 0,
    valueAtRetail: 0,
    deadStockValue: 0,
    expiryRiskValue: 0,
    expiredValue: 0,
    reorderCost: 0,
    reorderCount: 0,
    missingCostCount: 0,
  },
  sales: {
    today: { revenue: 0, invoices: 0 },
    periods: { 7: period(7), 30: period(30), 90: period(90) },
    weekdays: [],
    hours: [],
    peakHour: null,
  },
});

const stamp = (sourceVersion: number) => ({
  kind: "full" as const,
  generatedAt: 1_000,
  completedAt: 2_000,
  sourceGeneration: "3",
  sourceVersion,
  policyVersion: "policy-a",
  algorithmVersion: 1,
  today: 20_000,
  utcOffsetMinutes: 300,
  summarize: (reader: { productCount: () => number }, run: AnalyticsRun) =>
    summaryFor(run, reader.productCount()),
});

const withStore = <A>(use: (store: ReturnType<typeof makeAnalyticsStore>) => A) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* openAnalyticsDatabase(":memory:");
        return use(makeAnalyticsStore(database));
      }),
    ),
  );

const allRows = { filters: { view: "all" as const }, cursor: null, limit: 100 };

describe("analytics run publication", () => {
  it("publishes a run atomically with its source generation, version, policy and date", () =>
    withStore((store) => {
      const first = store.allocateRun();
      store.writeProducts(first, [analysis("a", "out", 90), analysis("b", "low", 50)]);
      expect(store.published()).toBeUndefined();
      expect(store.restockPage(allRows)).toBeUndefined();

      const run = store.publish({ runId: first, ...stamp(11) });
      expect(run).toMatchObject({
        runId: first,
        revision: 1,
        sourceGeneration: "3",
        sourceVersion: 11,
        policyVersion: "policy-a",
        today: 20_000,
        utcOffsetMinutes: 300,
        productCount: 2,
      });
      expect(store.published()?.summary.run).toEqual(run);

      const second = store.allocateRun();
      store.writeProducts(second, [analysis("c", "out", 80)]);
      expect(() =>
        store.publish({
          runId: second,
          ...stamp(12),
          summarize: () => {
            throw new Error("summary failed");
          },
        }),
      ).toThrow("summary failed");
      expect(store.publishedRun()).toEqual(run);
      expect(store.published()?.summary.run.sourceVersion).toBe(11);
      expect(store.restockPage(allRows)?.rows.map((row) => row.productId)).toEqual(["a", "b"]);
    }));

  it("keeps the last complete run readable while the next run is written and after it publishes", () =>
    withStore((store) => {
      const first = store.allocateRun();
      store.writeProducts(first, [analysis("a", "out", 90), analysis("b", "low", 50)]);
      const firstRun = store.publish({ runId: first, ...stamp(1) });
      const firstPage = store.restockPage({ ...allRows, limit: 1 });
      expect(firstPage?.nextCursor?.runId).toBe(first);

      const second = store.allocateRun();
      store.writeProducts(second, [analysis("x", "out", 95)]);
      store.writeProducts(second, [analysis("y", "out", 94), analysis("z", "low", 40)]);
      expect(store.publishedRun()).toEqual(firstRun);
      expect(store.restockPage(allRows)?.rows.map((row) => row.productId)).toEqual(["a", "b"]);
      expect(store.products(["a", "x"]).insights.map((row) => row.productId)).toEqual(["a"]);

      const secondRun = store.publish({ runId: second, ...stamp(2) });
      expect(secondRun.revision).toBe(2);
      expect(store.restockPage(allRows)?.rows.map((row) => row.productId)).toEqual(["x", "y", "z"]);
      const expired = store.restockPage({ ...allRows, cursor: firstPage?.nextCursor ?? null });
      expect(expired).toMatchObject({ cursorExpired: true, rows: [] });

      let removed = 1;
      while (removed > 0) {
        removed = store.discardSuperseded({ keepResults: [second], keepWork: [], limit: 2 });
      }
      expect(store.restockPage(allRows)?.rows).toHaveLength(3);

      const beforeIncremental = store.restockPage({ ...allRows, limit: 1 });
      expect(beforeIncremental?.nextCursor).toMatchObject({ runId: second, revision: 2 });
      const incremental = store.publish({
        runId: second,
        ...stamp(3),
        kind: "incremental",
        replace: { productIds: ["y"], analyses: [analysis("y", "healthy", 1)] },
      });
      expect(incremental.revision).toBe(3);
      expect(
        store.restockPage({ ...allRows, cursor: beforeIncremental?.nextCursor ?? null }),
      ).toMatchObject({ cursorExpired: true, rows: [] });
      expect(store.products(["y"]).insights[0]?.status).toBe("healthy");
      expect(store.published()?.summary.productCount).toBe(3);
    }));
});

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };
const managed = (createdAt: number) =>
  `${createdAt}, ${createdAt}, 'org-1', 'user-1', 'user-1', 'device-1', 'seed', 1`;
const metadataColumns =
  "createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion";

describe("analytics revenue ranking", () => {
  it("ranks only existing visible products, matching the visible-product oracle", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "analytics-ranking-"));
    const file = path.join(directory, "replica.sqlite");
    const today = 20_000;
    const replica = await openNodeReplicaSqlite(identity, file);
    const products = [
      ["p-a", 1],
      ["p-b", 1],
      ["p-hidden", 0],
    ] as const;
    const sales = [
      ["p-a", 300],
      ["p-b", 200],
      ["p-hidden", 900],
      ["p-deleted", 5_000],
    ] as const;
    const statements = [
      ...products.map(
        ([id, visible]) =>
          `insert into products (id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, ${metadataColumns}) values ('${id}', '${id}', 'general', null, null, null, 1, null, null, null, ${visible}, ${managed(1)})`,
      ),
      `insert into invoices (id, invoiceNumber, customerName, total, ${metadataColumns}) values ('i-1', 1, null, 6400, ${managed(today * INSIGHTS_DAY_MILLIS + 1_000)})`,
      ...sales.map(
        ([productId, price]) =>
          `insert into invoice_items (id, invoiceId, productId, batchId, productName, batchNumber, quantity, quantityType, baseUnitQuantity, salePrice, ${metadataColumns}) values ('l-${productId}', 'i-1', '${productId}', 'b-1', '${productId}', null, 1, 'unit', 1, ${price}, ${managed(1)})`,
      ),
    ];
    for (const statement of statements) await replica.query(statement, []);
    const visibleIds = new Set<string>(
      products.filter(([, visible]) => visible === 1).map(([id]) => id),
    );
    const oracle = sales
      .filter(([id, revenue]) => visibleIds.has(id) && revenue > 0)
      .map(([id, revenue]) => ({ id, revenue }))
      .sort((left, right) => right.revenue - left.revenue || (left.id < right.id ? -1 : 1));
    try {
      const ranking = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const store = makeAnalyticsStore(yield* openAnalyticsDatabase(":memory:"));
            const source = yield* openInventorySource(file);
            const runId = store.allocateRun();
            yield* source.snapshot((snapshot) =>
              Effect.sync(() =>
                store.workSales.insert(
                  runId,
                  snapshot.sales({ firstDay: today, lastDay: today, utcOffsetMinutes: 0 }),
                ),
              ),
            );
            return store.workSales.revenueRanking(runId, today - 89, today);
          }),
        ),
      );
      expect(ranking).toEqual(oracle);
    } finally {
      await replica.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
