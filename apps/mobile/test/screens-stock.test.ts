import { describe, expect, it } from "vitest";

import { DAY_MS } from "../src/features/format";
import { movementDelta } from "../src/features/stock/movement-text";
import { parseReceiveBatch } from "../src/features/stock/receive-batch";
import {
  batchAttention,
  batchOnHand,
  matchesStockFilter,
  onHandOf,
  stockAttention,
} from "../src/features/stock/stock-state";

const now = new Date(2026, 8, 24, 12).getTime();

const healthy = {
  expiredUnits: 0,
  status: "healthy" as const,
  lowStock: false,
  nearestExpiry: null,
};

describe("stock attention", () => {
  it("prefers expired stock over every other signal", () => {
    expect(
      stockAttention({ ...healthy, expiredUnits: 4, status: "out", lowStock: true }, now),
    ).toBe("expired");
  });

  it("marks out, low, and soon-to-expire stock in that order", () => {
    expect(stockAttention({ ...healthy, status: "out", lowStock: true }, now)).toBe("outOfStock");
    expect(stockAttention({ ...healthy, status: "low", lowStock: true }, now)).toBe("lowStock");
    expect(stockAttention({ ...healthy, nearestExpiry: now + 30 * DAY_MS }, now)).toBe(
      "expiringSoon",
    );
    expect(stockAttention({ ...healthy, nearestExpiry: now + 200 * DAY_MS }, now)).toBeNull();
  });
});

describe("stock filters", () => {
  const low = { ...healthy, status: "low" as const, lowStock: true };
  const expiring = { ...healthy, nearestExpiry: now + 10 * DAY_MS };
  const expired = { ...healthy, expiredUnits: 2 };

  it.each([
    ["all", [healthy, low, expiring, expired]],
    ["lowStock", [low]],
    ["expiringSoon", [expiring, expired]],
  ] as const)("keeps the matching stock for %s", (filter, kept) => {
    expect(
      [healthy, low, expiring, expired].filter((stock) => matchesStockFilter(stock, filter, now)),
    ).toEqual(kept);
  });

  it("flags batches by expiry", () => {
    expect(batchAttention(null, now)).toBeNull();
    expect(batchAttention(now - DAY_MS, now)).toBe("expired");
    expect(batchAttention(now + 5 * DAY_MS, now)).toBe("expiringSoon");
    expect(batchAttention(now + 365 * DAY_MS, now)).toBeNull();
  });
});

describe("on-hand counts", () => {
  it("shows packs with loose units for pack-tracked products", () => {
    expect(onHandOf(123, 10, true)).toEqual({ value: "12", unit: "packs + 3" });
    expect(onHandOf(10, 10, true)).toEqual({ value: "1", unit: "pack" });
  });

  it("shows units when packs are not tracked", () => {
    expect(onHandOf(1, 10, false)).toEqual({ value: "1", unit: "unit" });
    expect(onHandOf(2500, 1, true)).toEqual({ value: "2,500", unit: "units" });
  });

  it("describes a batch", () => {
    expect(batchOnHand(4, 2, 10, true)).toBe("4 packs + 2");
    expect(batchOnHand(1, 0, 10, true)).toBe("1 pack");
    expect(batchOnHand(1, 5, 10, false)).toBe("15 units");
  });
});

describe("stock movements", () => {
  it("signs pack and unit deltas", () => {
    expect(movementDelta({ packDelta: 12, unitDelta: 0 }, 10, true)).toBe("+12 packs");
    expect(movementDelta({ packDelta: -1, unitDelta: 10 }, 10, true)).toBe("−1 pack, +10 units");
    expect(movementDelta({ packDelta: 0, unitDelta: -3 }, 1, false)).toBe("−3 units");
  });
});

describe("receiving a batch by hand", () => {
  it("builds a draft from valid fields", () => {
    expect(
      parseReceiveBatch({ batchNumber: " B12 ", expiry: "08/27", packs: "12", units: "" }),
    ).toEqual({
      _tag: "valid",
      draft: {
        batchNumber: "B12",
        expiresAt: new Date(2027, 7, 31).getTime(),
        packQuantity: 12,
        unitQuantity: 0,
      },
    });
    expect(parseReceiveBatch({ batchNumber: " ", expiry: "  ", packs: "", units: "3" })).toEqual({
      _tag: "valid",
      draft: { batchNumber: null, expiresAt: null, packQuantity: 0, unitQuantity: 3 },
    });
  });

  it("points at the field that needs fixing", () => {
    expect(
      parseReceiveBatch({ batchNumber: "", expiry: "x", packs: "1", units: "" }),
    ).toMatchObject({
      _tag: "invalid",
      field: "expiry",
    });
    expect(
      parseReceiveBatch({ batchNumber: "", expiry: "", packs: "1.5", units: "" }),
    ).toMatchObject({
      _tag: "invalid",
      field: "packs",
    });
    expect(parseReceiveBatch({ batchNumber: "", expiry: "", packs: "", units: "" })).toMatchObject({
      _tag: "invalid",
      field: "packs",
      message: "Add at least one pack or unit.",
    });
  });
});
