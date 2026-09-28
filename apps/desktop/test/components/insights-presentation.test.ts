import { describe, expect, it } from "vitest";

import {
  formatCover,
  formatOrder,
  formatStockCover,
  HEALTH_ORDER,
  STATUS_META,
} from "@/components/insights/presentation";
import { EMPTY } from "@/lib/format";

describe("formatOrder", () => {
  it("pluralizes packs and units", () => {
    expect(formatOrder({ quantity: 1, unit: "packs", baseUnits: 10, cost: null })).toBe("1 pack");
    expect(formatOrder({ quantity: 4, unit: "packs", baseUnits: 40, cost: null })).toBe("4 packs");
    expect(formatOrder({ quantity: 1, unit: "units", baseUnits: 1, cost: null })).toBe("1 unit");
    expect(formatOrder({ quantity: 12, unit: "units", baseUnits: 12, cost: null })).toBe(
      "12 units",
    );
  });
});

describe("formatCover", () => {
  it("rounds down to whole days", () => {
    expect(formatCover(null)).toBe(EMPTY);
    expect(formatCover(0.4)).toBe("< 1 day");
    expect(formatCover(1.9)).toBe("1 day");
    expect(formatCover(13.2)).toBe("13 days");
    expect(formatCover(400)).toBe("1 yr+");
  });

  it("shows no cover when nothing is on hand", () => {
    expect(formatStockCover({ usableUnits: 0, daysOfCover: 0 })).toBe(EMPTY);
    expect(formatStockCover({ usableUnits: 3, daysOfCover: 4.2 })).toBe("4 days");
  });
});

describe("stock status vocabulary", () => {
  it("uses the canonical labels in canonical order", () => {
    expect(HEALTH_ORDER.map((status) => STATUS_META[status].label)).toEqual([
      "Out of stock",
      "Running out",
      "Reorder",
      "Healthy",
      "Overstocked",
      "Not selling",
    ]);
  });
});
