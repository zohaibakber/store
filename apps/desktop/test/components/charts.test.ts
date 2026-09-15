import { decodeProductId } from "@store/contracts";
import { createChartScene } from "@tanstack/charts";
import { describe, expect, it } from "vitest";

import { createRevenueChart } from "@/components/dashboard/revenue-chart";
import { createTopProductsChart } from "@/components/dashboard/top-products";
import { createStockMovementsChart } from "@/components/products/batches";

const sceneSize = { width: 640, height: 224 };

describe("createRevenueChart", () => {
  it("emits one interaction point per day", () => {
    const rows = [
      { date: "2026-08-01", revenue: 12_000, invoices: 2 },
      { date: "2026-08-02", revenue: 0, invoices: 0 },
      { date: "2026-08-03", revenue: 4_500, invoices: 1 },
    ];
    const scene = createChartScene(createRevenueChart(rows), sceneSize);
    expect(scene.points).toHaveLength(3);
    expect(scene.points.map((point) => point.datum.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });
});

describe("createTopProductsChart", () => {
  it("emits one bar point per product", () => {
    const rows = [
      {
        productId: decodeProductId("panadol"),
        productName: "Panadol",
        unitsSold: 12,
        revenue: 24_000,
      },
      {
        productId: decodeProductId("brufen"),
        productName: "Brufen",
        unitsSold: 4,
        revenue: 8_000,
      },
    ];
    const scene = createChartScene(createTopProductsChart(rows), sceneSize);
    const barPoints = scene.points.filter((point) => point.markId === "product-bars");
    expect(barPoints).toHaveLength(2);
    expect(barPoints.map((point) => point.datum.productName)).toEqual(["Panadol", "Brufen"]);
  });
});

describe("createStockMovementsChart", () => {
  it("keeps signed bars for stock in and stock out", () => {
    const rows = [
      { date: "2026-08-01", net: 10 },
      { date: "2026-08-02", net: -4 },
    ];
    const scene = createChartScene(createStockMovementsChart(rows), sceneSize);
    expect(scene.points).toHaveLength(2);
    expect(scene.points.map((point) => point.datum.net)).toEqual([10, -4]);
  });
});
