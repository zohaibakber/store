import { analyzeInsights, DEFAULT_STOCK_POLICY, insightsWindowFor } from "@store/services/insights";
import { describe, expect, it } from "vitest";

import { buyListHeader, buyListLine } from "@/components/insights/buy-list";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 20, 7);
const today = Math.floor(now / DAY);

const report = analyzeInsights(
  {
    window: insightsWindowFor(now, 0),
    products: [
      {
        id: "p-1",
        name: '=HYPERLINK("x")',
        categoryId: "c",
        categoryName: "Tablets",
        tracksPacks: true,
        unitsPerPack: 10,
        purchasePrice: 1_000,
        retailPrice: 1_500,
        unitPrice: null,
        visible: true,
        createdAt: now - 120 * DAY,
      },
      {
        id: "p-2",
        name: "Stocked",
        categoryId: "c",
        categoryName: "Tablets",
        tracksPacks: false,
        unitsPerPack: 1,
        purchasePrice: null,
        retailPrice: 100,
        unitPrice: null,
        visible: true,
        createdAt: now - 120 * DAY,
      },
    ],
    batches: [
      {
        productId: "p-2",
        batchNumber: null,
        packQuantity: 0,
        unitQuantity: 5_000,
        expiresAt: null,
      },
    ],
    sales: Array.from({ length: 60 }, (_, age) => ({
      productId: "p-1",
      day: today - age - 1,
      units: 5,
      revenue: 750,
    })),
    onOrder: [],
    days: [],
    hours: [],
    truncated: false,
  },
  DEFAULT_STOCK_POLICY,
  now,
);

describe("buy list CSV", () => {
  it("exports only suggested orders and neutralizes spreadsheet formulas", () => {
    const header = buyListHeader();
    const rows = report.products.flatMap((insight) => buyListLine(insight) ?? []);
    expect(header).toContain('"Order quantity"');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^"'=HYPERLINK\(""x""\)","Tablets","A","Out of stock"/u);
    expect(rows[0]).toContain('"packs"');
  });
});
