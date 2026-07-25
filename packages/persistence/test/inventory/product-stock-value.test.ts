import { productStockValue } from "@store/contracts/store-helpers";
import { describe, expect, test } from "vitest";

const product = (packPrice: number | null, unitPrice: number | null, unitsPerPack = 10) => ({
  packPrice,
  unitPrice,
  unitsPerPack,
  batches: [{ packQuantity: 2, unitQuantity: 3 }],
});

describe("productStockValue", () => {
  test("uses pack and unit prices for their matching quantities", () => {
    expect(productStockValue(product(900, 100))).toBe(2_100);
  });

  test("derives a proportional unit value when only pack price exists", () => {
    expect(productStockValue(product(1_000, null))).toBe(2_300);
  });

  test("derives a pack value when only unit price exists", () => {
    expect(productStockValue(product(null, 100))).toBe(2_300);
  });

  test("does not invent a value when neither price exists", () => {
    expect(productStockValue(product(null, null))).toBe(0);
  });

  test("rounds the final proportional value to the nearest paisa", () => {
    expect(
      productStockValue({
        packPrice: 999,
        unitPrice: null,
        unitsPerPack: 8,
        batches: [{ packQuantity: 0, unitQuantity: 3 }],
      }),
    ).toBe(375);
  });
});
