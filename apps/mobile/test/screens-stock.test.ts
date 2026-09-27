import { describe, expect, it } from "vitest";

import { DAY_MS } from "../src/features/format";
import { movementDelta, movementLabel } from "../src/features/stock/movement-text";
import { parseReceiveBatch } from "../src/features/stock/receive-batch";
import {
  attentionLabel,
  batchAttention,
  batchOnHand,
  matchesStockFilter,
  onHandOf,
  productSubtitle,
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

  it("labels each attention state", () => {
    expect(attentionLabel("lowStock")).toBe("Low stock");
    expect(attentionLabel("expiringSoon")).toBe("Expires soon");
  });
});

describe("stock filters", () => {
  const low = { ...healthy, status: "low" as const, lowStock: true };
  const expiring = { ...healthy, nearestExpiry: now + 10 * DAY_MS };
  const expired = { ...healthy, expiredUnits: 2 };

  it("keeps everything for All", () => {
    expect([healthy, low, expiring].every((stock) => matchesStockFilter(stock, "all", now))).toBe(
      true,
    );
  });

  it("keeps only low stock for Low stock", () => {
    expect(matchesStockFilter(low, "lowStock", now)).toBe(true);
    expect(matchesStockFilter(expiring, "lowStock", now)).toBe(false);
  });

  it("keeps expired and soon-to-expire stock for Expiring soon", () => {
    expect(matchesStockFilter(expiring, "expiringSoon", now)).toBe(true);
    expect(matchesStockFilter(expired, "expiringSoon", now)).toBe(true);
    expect(matchesStockFilter(low, "expiringSoon", now)).toBe(false);
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

  it("joins composition, strength, and pack size", () => {
    expect(
      productSubtitle({ composition: "Paracetamol", strength: "500 mg", unitsPerPack: 20 }),
    ).toBe("Paracetamol · 500 mg · 20 per pack");
    expect(productSubtitle({ composition: " ", strength: null, unitsPerPack: 1 })).toBe("");
  });
});

describe("stock movements", () => {
  it("labels movement types", () => {
    expect(movementLabel("stock_in")).toBe("Received");
    expect(movementLabel("open_pack")).toBe("Pack opened");
  });

  it("signs pack and unit deltas", () => {
    expect(movementDelta({ packDelta: 12, unitDelta: 0 }, 10, true)).toBe("+12 packs");
    expect(movementDelta({ packDelta: -1, unitDelta: 10 }, 10, true)).toBe("−1 pack, +10 units");
    expect(movementDelta({ packDelta: 0, unitDelta: -3 }, 1, false)).toBe("−3 units");
  });
});

describe("receiving a batch by hand", () => {
  const expiryOf = (expiry: string) => {
    const parsed = parseReceiveBatch({ batchNumber: "", expiry, packs: "1", units: "" });
    return parsed._tag === "valid" ? parsed.draft.expiresAt : "invalid";
  };

  it("reads month and year expiries as the end of that month", () => {
    expect(expiryOf("08/27")).toBe(new Date(2027, 7, 31).getTime());
    expect(expiryOf("2027-02")).toBe(new Date(2027, 1, 28).getTime());
  });

  it("reads full dates day first or year first", () => {
    expect(expiryOf("15/03/2028")).toBe(new Date(2028, 2, 15).getTime());
    expect(expiryOf("2028-03-15")).toBe(new Date(2028, 2, 15).getTime());
  });

  it("treats a blank expiry as none and rejects impossible dates", () => {
    expect(expiryOf("  ")).toBeNull();
    expect(expiryOf("31/02/2027")).toBe("invalid");
    expect(expiryOf("13/27")).toBe("invalid");
    expect(expiryOf("soon")).toBe("invalid");
  });

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
