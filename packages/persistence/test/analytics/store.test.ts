import { afterEach, expect, test, vi } from "vitest";

import { store, withTestStore } from "../lib/store";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 24, 12, 0, 0);
const todayStart = NOW - (NOW % DAY_MS);
const windowStart = todayStart - 29 * DAY_MS;
const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

afterEach(() => {
  vi.useRealTimers();
});

const workspaceFor = (organizationId: string) => ({
  organizationId,
  userId: "tester",
  deviceId: "device-1",
});

test("dashboard analytics aggregates revenue, stock health, and recent activity", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await withTestStore(
    async ({ runtime, makeRuntime }) => {
      vi.setSystemTime(NOW);
      const amoxil = await runtime.runPromise(
        store((s) =>
          s.createProduct({
            name: "Amoxil",
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 10,
            packPrice: 1000,
            unitPrice: 100,
          }),
        ),
      );
      const bandage = await runtime.runPromise(
        store((s) =>
          s.createProduct({
            name: "Bandage",
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 1,
            packPrice: null,
            unitPrice: 50,
          }),
        ),
      );
      const cream = await runtime.runPromise(
        store((s) =>
          s.createProduct({
            name: "Cream",
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 1,
            packPrice: null,
            unitPrice: 10,
            visible: false,
          }),
        ),
      );
      await runtime.runPromise(
        store((s) =>
          s.createProduct({
            name: "Distilled water",
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 1,
            packPrice: null,
            unitPrice: 20,
          }),
        ),
      );

      await runtime.runPromise(
        store((s) =>
          s.createBatch({
            productId: amoxil.id,
            batchNumber: "A1",
            expiresAt: NOW + 10 * DAY_MS,
            packQuantity: 6,
            unitQuantity: 0,
          }),
        ),
      );
      await runtime.runPromise(
        store((s) =>
          s.createBatch({
            productId: amoxil.id,
            batchNumber: "A2",
            expiresAt: null,
            packQuantity: 2,
            unitQuantity: 0,
          }),
        ),
      );
      await runtime.runPromise(
        store((s) =>
          s.createBatch({
            productId: bandage.id,
            batchNumber: "B1",
            expiresAt: NOW + 90 * DAY_MS,
            packQuantity: 0,
            unitQuantity: 12,
          }),
        ),
      );
      await runtime.runPromise(
        store((s) =>
          s.createBatch({
            productId: cream.id,
            batchNumber: null,
            expiresAt: null,
            packQuantity: 0,
            unitQuantity: 1,
          }),
        ),
      );

      const sell = (productId: string, quantity: number, salePrice: number) =>
        runtime.runPromise(
          store((s) =>
            s.createInvoice({
              customerName: null,
              items: [{ productId, batchId: null, quantity, quantityType: "unit", salePrice }],
            }),
          ),
        );

      vi.setSystemTime(todayStart - 40 * DAY_MS);
      await sell(amoxil.id, 1, 100);
      vi.setSystemTime(windowStart);
      await sell(amoxil.id, 2, 100);
      vi.setSystemTime(todayStart - 3 * DAY_MS);
      await sell(bandage.id, 2, 50);
      vi.setSystemTime(NOW);
      await sell(amoxil.id, 3, 100);

      const analytics = await runtime.runPromise(store((s) => s.getDashboardAnalytics));

      expect(analytics.totals).toEqual({
        revenueToday: 300,
        revenue7d: 400,
        revenue30d: 600,
        invoicesToday: 1,
        invoices30d: 3,
        averageInvoice30d: 200,
        activeProducts: 3,
      });

      expect(analytics.revenueByDay).toHaveLength(30);
      expect(analytics.revenueByDay[0]).toEqual({
        date: isoDay(windowStart),
        revenue: 200,
        invoices: 1,
      });
      expect(analytics.revenueByDay.at(-1)).toEqual({
        date: isoDay(todayStart),
        revenue: 300,
        invoices: 1,
      });
      const nonZeroDays = analytics.revenueByDay.filter((day) => day.invoices > 0);
      expect(nonZeroDays).toHaveLength(3);
      expect(nonZeroDays[1]).toEqual({
        date: isoDay(todayStart - 3 * DAY_MS),
        revenue: 100,
        invoices: 1,
      });

      expect(analytics.topProducts).toEqual([
        { productId: amoxil.id, productName: "Amoxil", unitsSold: 5, revenue: 500 },
        { productId: bandage.id, productName: "Bandage", unitsSold: 2, revenue: 100 },
      ]);

      expect(analytics.expiringBatches).toEqual([
        {
          productId: amoxil.id,
          productName: "Amoxil",
          batchNumber: "A1",
          expiresAt: NOW + 10 * DAY_MS,
          packQuantity: 5,
          unitQuantity: 4,
        },
      ]);

      expect(analytics.lowStock).toEqual([
        {
          productId: expect.any(String),
          productName: "Distilled water",
          packQuantity: 0,
          unitQuantity: 0,
        },
        { productId: bandage.id, productName: "Bandage", packQuantity: 0, unitQuantity: 10 },
      ]);

      expect(analytics.recentInvoices).toHaveLength(4);
      expect(analytics.recentInvoices.map((invoice) => invoice.total)).toEqual([
        300, 100, 200, 100,
      ]);
      expect(analytics.recentInvoices[0]?.createdAt).toBe(NOW);

      // The same database, opened as a different organization: none of the
      // seeded activity belongs to it.
      const otherOrganization = makeRuntime({ workspace: workspaceFor("org-b") });
      const other = await otherOrganization.runPromise(store((s) => s.getDashboardAnalytics));
      expect(other.totals).toEqual({
        revenueToday: 0,
        revenue7d: 0,
        revenue30d: 0,
        invoicesToday: 0,
        invoices30d: 0,
        averageInvoice30d: 0,
        activeProducts: 0,
      });
      expect(other.topProducts).toEqual([]);
      expect(other.expiringBatches).toEqual([]);
      expect(other.lowStock).toEqual([]);
      expect(other.recentInvoices).toEqual([]);
      expect(other.revenueByDay.every((day) => day.revenue === 0 && day.invoices === 0)).toBe(true);
    },
    { workspace: workspaceFor("org-a") },
  );
});
