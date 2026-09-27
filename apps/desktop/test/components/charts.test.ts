import { createChartScene } from "@tanstack/charts";
import { describe, expect, it } from "vitest";

import { createRevenueTrendChart, createWeekdayChart } from "@/components/insights/charts";
import { createStockMovementsChart } from "@/components/products/batches";

const sceneSize = { width: 640, height: 224 };

const DAY = 86_400_000;

describe("createRevenueTrendChart", () => {
  it("plots the period and its comparison line for each day", () => {
    const rows = [0, 1, 2].map((offset) => ({
      day: 20_000 + offset,
      date: (20_000 + offset) * DAY,
      revenue: offset * 1_000,
      invoices: offset,
      previousRevenue: 500,
    }));
    const scene = createChartScene(createRevenueTrendChart(rows), sceneSize);
    const current = scene.points.filter((point) => point.markId === "revenue");
    const previous = scene.points.filter((point) => point.markId === "previous");
    expect(current).toHaveLength(3);
    expect(previous).toHaveLength(3);
  });
});

describe("createWeekdayChart", () => {
  it("emits one bar per weekday", () => {
    const rows = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      revenue: weekday * 100,
      peak: weekday === 6,
    }));
    const scene = createChartScene(createWeekdayChart(rows), sceneSize);
    expect(scene.points.filter((point) => point.markId === "weekday")).toHaveLength(7);
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
