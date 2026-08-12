import { describe, expect, it } from "vitest";

import {
  applyProductSyncChanges,
  assertSyncProgress,
  restoreProductSyncState,
  serializeProductSyncState,
} from "../src/lib/product-sync-state";

const organizationId = "organization-1";

describe("product sync state", () => {
  it("persists the cursor and incrementally applies upserts and deletes", () => {
    const state = restoreProductSyncState(null, organizationId);

    applyProductSyncChanges(state.maps, [
      {
        cursor: 1,
        change: {
          entity: "category",
          action: "upsert",
          entityId: "category-1",
          row: { id: "category-1", name: "Tablets", tracksPacks: true },
        },
      },
      {
        cursor: 2,
        change: {
          entity: "product",
          action: "upsert",
          entityId: "product-1",
          row: {
            id: "product-1",
            name: "Aceta Plus",
            categoryId: "category-1",
            composition: null,
            strength: null,
            aisle: null,
            unitsPerPack: 10,
            packPrice: 1200,
            unitPrice: 120,
            visible: true,
          },
        },
      },
    ]);

    const restored = restoreProductSyncState(
      serializeProductSyncState(organizationId, 2, state.maps),
      organizationId,
    );
    expect(restored.cursor).toBe(2);
    expect(restored.maps.products.get("product-1")?.name).toBe("Aceta Plus");

    applyProductSyncChanges(restored.maps, [
      {
        cursor: 3,
        change: {
          entity: "product",
          action: "delete",
          entityId: "product-1",
          row: null,
        },
      },
    ]);
    expect(restored.maps.products.has("product-1")).toBe(false);
  });

  it("discards malformed or cross-organization caches", () => {
    expect(restoreProductSyncState("not json", organizationId).cursor).toBe(0);
    expect(
      restoreProductSyncState(
        JSON.stringify({
          version: 1,
          organizationId: "another-organization",
          cursor: 10,
          categories: [],
          products: [],
          batches: [],
        }),
        organizationId,
      ).cursor,
    ).toBe(0);
  });

  it("rejects backwards cursors and pages that cannot make progress", () => {
    expect(() => assertSyncProgress(10, 9, false)).toThrow("sync stalled");
    expect(() => assertSyncProgress(10, 10, true)).toThrow("sync stalled");
    expect(() => assertSyncProgress(10, 10, false)).not.toThrow();
    expect(() => assertSyncProgress(10, 11, true)).not.toThrow();
  });
});
