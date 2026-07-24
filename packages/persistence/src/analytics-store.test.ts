import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, expect, test, vi } from "vitest";

import { layer } from "./index";
import { migrationsFolder, store } from "./test-support";

const DAY_MS = 86_400_000;
// Noon UTC keeps every seeded timestamp inside an unambiguous UTC day.
const NOW = Date.UTC(2026, 6, 24, 12, 0, 0);
const todayStart = NOW - (NOW % DAY_MS);
const windowStart = todayStart - 29 * DAY_MS;
const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

afterEach(() => {
  vi.useRealTimers();
});

test("dashboard analytics aggregates revenue, stock health, and recent activity", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const directory = await mkdtemp(path.join(tmpdir(), "store-analytics-"));
  let organizationId = "org-a";
  const runtime = ManagedRuntime.make(
    layer({
      dataDir: path.join(directory, "pglite"),
      migrationsFolder,
      mutationContext: () => ({ organizationId, userId: "tester", deviceId: "device-1" }),
    }),
  );

  try {
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

    // Expires in 10 days -> shows in the expiring list.
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
    // No expiry date -> excluded from the expiring list.
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
    // Exactly at the 90-day boundary -> excluded (window is [now, now + 90d)).
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
    // Hidden product stock stays out of low-stock and active-product counts.
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

    // 40 days ago: outside the 30-day window but still a recent invoice.
    vi.setSystemTime(todayStart - 40 * DAY_MS);
    await sell(amoxil.id, 1, 100);
    // Exactly at the start of the 30-day window: included (boundary).
    vi.setSystemTime(windowStart);
    await sell(amoxil.id, 2, 100);
    // Three days ago: inside the 7-day window.
    vi.setSystemTime(todayStart - 3 * DAY_MS);
    await sell(bandage.id, 2, 50);
    // Today.
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

    // Ordered by 30-day revenue; the 40-day-old sale does not count.
    expect(analytics.topProducts).toEqual([
      { productId: amoxil.id, productName: "Amoxil", unitsSold: 5, revenue: 500 },
      { productId: bandage.id, productName: "Bandage", unitsSold: 2, revenue: 100 },
    ]);

    // FEFO drew the 6 sold units from A1 (opened one pack of 10).
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

    // Distilled water has no stock at all; Bandage is exactly at the
    // threshold of 10 units after selling 2 of 12. Amoxil (74 units) and the
    // hidden Cream stay out.
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
    expect(analytics.recentInvoices.map((invoice) => invoice.total)).toEqual([300, 100, 200, 100]);
    expect(analytics.recentInvoices[0]?.createdAt).toBe(NOW);

    // A second organization sees none of this data.
    organizationId = "org-b";
    const other = await runtime.runPromise(store((s) => s.getDashboardAnalytics));
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
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
