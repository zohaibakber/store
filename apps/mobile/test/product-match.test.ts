import { describe, expect, it } from "vitest";

import { findProductMatch } from "../src/features/product-scanner/product-match";
import type { ProductScanResult } from "../src/features/product-scanner/types";
import type { MobileProduct } from "../src/lib/inventory-types";

const product = (overrides: Partial<MobileProduct> = {}): MobileProduct => ({
  id: "p-10",
  name: "Amoxicillin",
  categoryId: "general",
  category: "General",
  tracksPacks: true,
  composition: null,
  strength: "500mg",
  details: "",
  aisle: null,
  unitsPerPack: 10,
  packPrice: null,
  unitPrice: null,
  visible: true,
  stock: 0,
  stockLabel: "0",
  batches: [],
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const scan = (overrides: Partial<ProductScanResult> = {}): ProductScanResult => ({
  name: "Amoxicillin",
  composition: null,
  strength: "500mg",
  unitsPerPack: 20,
  batchNumber: null,
  expiresAt: null,
  confidence: 0.9,
  ...overrides,
});

describe("findProductMatch", () => {
  it("does not bind a same-name product with a different pack size", () => {
    const match = findProductMatch(
      [product({ id: "p-10", unitsPerPack: 10 })],
      scan({ unitsPerPack: 20 }),
      "Amoxicillin 20s",
    );
    expect(match).toBeNull();
  });

  it("binds the SKU whose units per pack match the scan", () => {
    const ten = product({ id: "p-10", unitsPerPack: 10 });
    const twenty = product({ id: "p-20", unitsPerPack: 20 });
    const match = findProductMatch([ten, twenty], scan({ unitsPerPack: 20 }), "Amoxicillin 20s");
    expect(match?.id).toBe("p-20");
  });

  it("still matches by name when the scan has no pack size", () => {
    const match = findProductMatch(
      [product({ id: "p-10", unitsPerPack: 10 })],
      scan({ unitsPerPack: null }),
      "Amoxicillin",
    );
    expect(match?.id).toBe("p-10");
  });
});
