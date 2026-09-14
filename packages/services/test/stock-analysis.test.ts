import type { Invoice, Product } from "@store/contracts";
import { describe, expect, test } from "vitest";

import { recommendStock } from "../src/stock-recommendations/analysis";
import { DEFAULT_STOCK_POLICY } from "../src/stock-recommendations/policy";
import { DAY, now, product, batch, sale, dailySales } from "./stock-fixtures";

const recommend = (details: Partial<Product> = {}, invoices = dailySales) =>
  recommendStock([{ ...product, ...details }], invoices, DEFAULT_STOCK_POLICY, now)[0];

describe("stock purchasing recommendations", () => {
  test("uses demand to flag low stock above the fixed minimum and rounds purchases to packs", () => {
    const row = recommend({ batches: [batch(85)] });
    expect(row).toMatchObject({
      status: "low",
      availableUnits: 85,
      units30d: 300,
      dailyDemand: 10,
      reorderPoint: 100,
      orderQuantity: 32,
      orderUnits: 320,
      estimatedCost: 32000,
      history: "established",
    });
    expect(row?.daysRemaining).toBe(8.5);
  });
  test("zero-stock products with repeated demand lead the buy list", () => {
    expect(recommend()).toMatchObject({ status: "out", orderQuantity: 40 });
  });
  test("does not invent demand or buy quantities without history", () => {
    expect(recommend({}, [])).toMatchObject({
      status: "out",
      orderQuantity: 0,
      dailyDemand: 0,
      daysRemaining: null,
      history: "limited",
    });
  });
  test("one bulk purchase does not create confident demand", () => {
    expect(recommend({}, [sale(1, 1000)])).toMatchObject({
      history: "limited",
      orderQuantity: 0,
    });
  });
  test("new products normalize for age but still require observation time", () => {
    const sales = Array.from({ length: 5 }, (_, i) => sale(i, 10));
    expect(recommend({ createdAt: now - 5 * DAY }, sales)).toMatchObject({
      dailyDemand: 10,
      history: "limited",
      orderQuantity: 0,
    });
  });
  test("distinguishes rising and declining demand", () => {
    expect(
      recommend(
        {},
        dailySales.map((_invoice, i) => sale(i, i < 7 ? 20 : 10)),
      )?.trend,
    ).toBe("rising");
    expect(
      recommend(
        {},
        dailySales.map((_invoice, i) => sale(i, i < 7 ? 2 : 10)),
      )?.trend,
    ).toBe("falling");
  });
  test("uses immutable sale base quantities even when pack size changes", () => {
    const sales: Invoice[] = dailySales.map((invoice) => ({
      ...invoice,
      items: invoice.items.map((item) => ({
        ...item,
        quantity: 1,
        quantityType: "pack" satisfies "pack",
      })),
    }));
    expect(recommend({ unitsPerPack: 20 }, sales)).toMatchObject({
      units30d: 300,
      orderQuantity: 20,
    });
  });
  test("excludes expired stock and projects unsold expiring units in expiry order", () => {
    expect(recommend({ batches: [batch(100, now)] })).toMatchObject({
      status: "out",
      availableUnits: 0,
      expiredUnits: 100,
    });
    const row = recommend({ batches: [batch(100, now + 5 * DAY), batch(100, now + 2 * DAY)] });
    expect(row).toMatchObject({
      availableUnits: 200,
      expiryRiskUnits: 150,
      status: "low",
      orderQuantity: 35,
    });
  });
  test("flags stale and excessive stock without encouraging purchases", () => {
    expect(recommend({ batches: [batch(5)] }, [sale(50, 20)])).toMatchObject({
      slowMoving: true,
      units30d: 0,
      units90d: 20,
      orderQuantity: 0,
    });
    expect(recommend({ batches: [batch(1000)] })).toMatchObject({
      slowMoving: true,
      status: "healthy",
      orderQuantity: 0,
    });
  });
  test("excludes hidden products, future sales and sales outside the history window", () => {
    expect(
      recommendStock([{ ...product, visible: false }], dailySales, DEFAULT_STOCK_POLICY, now),
    ).toEqual([]);
    expect(recommend({}, [sale(-1, 500), sale(90, 500)])).toMatchObject({
      units30d: 0,
      units90d: 0,
      orderQuantity: 0,
    });
  });
  test("planning assumptions alter reorder timing and buy quantity", () => {
    const rows = recommendStock(
      [{ ...product, batches: [batch(150)] }],
      dailySales,
      { ...DEFAULT_STOCK_POLICY, leadDays: 20 },
      now,
    );
    expect(rows[0]).toMatchObject({ status: "low", reorderPoint: 230, orderQuantity: 38 });
  });
  test("unit-only categories buy whole units", () => {
    expect(
      recommend({ category: { ...product.category, tracksPacks: false }, unitsPerPack: 1 }),
    ).toMatchObject({ orderQuantity: 400, orderUnit: "units", orderUnits: 400 });
  });
});
