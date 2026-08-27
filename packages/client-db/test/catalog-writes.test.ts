import { catalogWriteError } from "@store/contracts/catalog-rules";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { makeCatalogWrites, type CatalogWriteTables } from "../src/catalog-writes";
import type { BatchRow, CategoryRow, ProductRow } from "../src/rows";

const memoryCollection = <Row extends { readonly id: string }>(
  initial: ReadonlyArray<Row> = [],
) => {
  const rows = new Map(initial.map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => rows.get(id),
      values: () => rows.values(),
    },
    insert: (row: Row) => {
      rows.set(row.id, row);
      return { isPersisted: { promise: Promise.resolve() } };
    },
    update: (id: string, updater: (draft: Row) => void) => {
      const current = rows.get(id);
      if (!current) throw new Error(`missing ${id}`);
      const draft = { ...current };
      updater(draft);
      rows.set(id, draft);
      return { isPersisted: { promise: Promise.resolve() } };
    },
  };
};

const actor = {
  organizationId: "org-1",
  userId: "user-1",
  deviceId: "device-1",
};

const ids = {
  now: () => 1_700_000_000_000,
  operationId: () => "operation-1",
  rowId: () => "generated-1",
};

const tables = (seed?: {
  readonly categories?: CategoryRow[];
  readonly products?: ProductRow[];
  readonly batches?: BatchRow[];
}): CatalogWriteTables => ({
  categories: memoryCollection(seed?.categories),
  products: memoryCollection(seed?.products),
  batches: memoryCollection(seed?.batches),
});

const category = (overrides: Partial<CategoryRow> = {}): CategoryRow => ({
  id: decodeCategoryId("category-1"),
  name: "General",
  tracksPacks: true,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

const product = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: decodeProductId("product-1"),
  name: "Paracetamol",
  categoryId: decodeCategoryId("category-1"),
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  packPrice: null,
  unitPrice: null,
  visible: true,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

const batch = (overrides: Partial<BatchRow> = {}): BatchRow => ({
  id: decodeBatchId("batch-1"),
  productId: decodeProductId("product-1"),
  batchNumber: "A",
  expiresAt: null,
  packQuantity: 0,
  unitQuantity: 0,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

describe("makeCatalogWrites", () => {
  it("returns an existing category instead of inserting a duplicate name", async () => {
    const catalog = tables({ categories: [category()] });
    const writes = makeCatalogWrites(catalog, actor, ids);
    const row = await writes.createCategory({ name: "general" });
    expect(row.id).toBe("category-1");
    expect([...catalog.categories.state.values()]).toHaveLength(1);
  });

  it("refuses to delete a category that still has products", async () => {
    const writes = makeCatalogWrites(
      tables({ categories: [category()], products: [product()] }),
      actor,
      ids,
    );
    await expect(writes.deleteCategory(decodeCategoryId("category-1"))).rejects.toThrow(
      catalogWriteError.categoryHasProducts,
    );
  });

  it("refuses to change pack size while stock remains", async () => {
    const writes = makeCatalogWrites(
      tables({
        categories: [category()],
        products: [product()],
        batches: [batch({ packQuantity: 2 })],
      }),
      actor,
      ids,
    );
    await expect(
      writes.updateProduct({
        id: decodeProductId("product-1"),
        name: "Paracetamol",
        categoryId: "category-1",
        unitsPerPack: 12,
      }),
    ).rejects.toThrow(catalogWriteError.unitsPerPackWithStock);
  });

  it("creates a batch with caller-supplied identity and zero quantity", async () => {
    const catalog = tables({ categories: [category()], products: [product()] });
    const writes = makeCatalogWrites(catalog, actor, ids);
    const row = await writes.createBatch({
      id: "batch-scan",
      productId: "product-1",
      packQuantity: 0,
      unitQuantity: 0,
    });
    expect(row.id).toBe("batch-scan");
    expect(row.packQuantity).toBe(0);
    expect(catalog.batches.state.get("batch-scan")?.operationId).toBe("operation-1");
  });
});
