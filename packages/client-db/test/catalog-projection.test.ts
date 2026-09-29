import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import {
  projectCreateBatch,
  projectCreateCategory,
  projectCreateProduct,
  projectDeleteBatch,
  projectDeleteCategory,
  projectDeleteProduct,
  projectImportInventory,
  projectUpdateBatch,
  projectUpdateCategory,
  projectUpdateProduct,
  type CatalogProjectionContext,
  type CatalogProjectionTables,
} from "../src/catalog-projection";
import type { BatchRow, CategoryRow, ProductRow } from "../src/rows";

const actor = {
  organizationId: "org-1",
  userId: "user-1",
  deviceId: "device-1",
};

const metadata = {
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 2,
  createdAt: 10,
  updatedAt: 10,
};

const categoryId = decodeCategoryId("category-1");
const productId = decodeProductId("product-1");
const batchId = decodeBatchId("batch-1");

const category: CategoryRow = { id: categoryId, name: "Tea", tracksPacks: true, ...metadata };

const product: ProductRow = {
  id: productId,
  name: "Green",
  categoryId,
  aisle: "A1",
  composition: null,
  strength: null,
  unitsPerPack: 10,
  purchasePrice: 100,
  retailPrice: 150,
  unitPrice: 20,
  visible: true,
  ...metadata,
};

const emptyBatch: BatchRow = {
  id: batchId,
  productId,
  batchNumber: "B1",
  expiresAt: null,
  packQuantity: 0,
  unitQuantity: 0,
  ...metadata,
};

const collectionOf = <Row extends { readonly id: string }>(rows: ReadonlyArray<Row>) => {
  const map = new Map(rows.map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => map.get(id),
      values: () => map.values(),
    },
  };
};

const contextWith = (tables?: Partial<CatalogProjectionTables>): CatalogProjectionContext => {
  let counter = 0;
  return {
    actor,
    commandId: "command-1",
    occurredAt: 1_000,
    ids: {
      now: () => 1_000,
      operationId: () => "command-1",
      rowId: () => {
        counter += 1;
        return `generated-${counter}`;
      },
    },
    tables: {
      batches: tables?.batches ?? collectionOf<BatchRow>([]),
      categories: tables?.categories ?? collectionOf([category]),
      products: tables?.products ?? collectionOf([product]),
    },
  };
};

describe("catalog projection", () => {
  it("projects a category insert with a null expected row version", () => {
    const context = contextWith({ categories: collectionOf<CategoryRow>([]) });
    const projected = projectCreateCategory(context, { name: " Coffee " });
    expect(projected.row).toMatchObject({ name: "Coffee", rowVersion: 1 });
    expect(projected.writes).toEqual([
      {
        entity: "category",
        action: "upsert",
        id: "generated-1",
        expectedRowVersion: null,
        row: { name: "Coffee", tracksPacks: true },
      },
    ]);
  });

  it("returns the existing category and no writes for a duplicate name", () => {
    const projected = projectCreateCategory(contextWith(), { name: "tea" });
    expect(projected.writes).toEqual([]);
    expect(projected.row.id).toBe(categoryId);
  });

  it("projects a category update guarded by the current row version", () => {
    const projected = projectUpdateCategory(contextWith(), {
      id: categoryId,
      name: "Herbal",
      tracksPacks: false,
    });
    expect(projected.row.rowVersion).toBe(3);
    expect(projected.writes[0]).toEqual({
      entity: "category",
      action: "upsert",
      id: categoryId,
      expectedRowVersion: 2,
      row: { name: "Herbal", tracksPacks: false },
    });
  });

  it.each([
    [
      "a category delete while active products remain",
      () => projectDeleteCategory(contextWith(), categoryId),
      "Move products to another category before deleting this category.",
    ],
    [
      "a units-per-pack change while stock remains",
      () =>
        projectUpdateProduct(
          contextWith({ batches: collectionOf([{ ...emptyBatch, packQuantity: 3 }]) }),
          { id: productId, name: "Green", categoryId, unitsPerPack: 4 },
        ),
      "Change units per pack only after the product has no remaining stock.",
    ],
    [
      "a product delete while stock remains",
      () =>
        projectDeleteProduct(
          contextWith({ batches: collectionOf([{ ...emptyBatch, unitQuantity: 1 }]) }),
          productId,
        ),
      "Clear remaining stock before deleting this product.",
    ],
    [
      "a batch delete while stock remains",
      () =>
        projectDeleteBatch(
          contextWith({ batches: collectionOf([{ ...emptyBatch, packQuantity: 1 }]) }),
          batchId,
        ),
      "Clear remaining stock before deleting this batch.",
    ],
    [
      "a negative quantity",
      () => projectCreateBatch(contextWith(), { productId, packQuantity: -1 }),
      "Pack quantity must be a non-negative whole number.",
    ],
  ])("refuses %s", (_name, project, message) => {
    expect(project).toThrow(message);
  });

  it("projects a category delete carrying the current row version", () => {
    const context = contextWith({ products: collectionOf<ProductRow>([]) });
    expect(projectDeleteCategory(context, categoryId).writes).toEqual([
      { entity: "category", action: "delete", id: categoryId, expectedRowVersion: 2 },
    ]);
  });

  it("projects a product insert with the full field set", () => {
    const projected = projectCreateProduct(contextWith(), {
      name: "Oolong",
      categoryId,
      unitsPerPack: 5,
    });
    expect(projected.writes[0]).toEqual({
      entity: "product",
      action: "upsert",
      id: "generated-1",
      expectedRowVersion: null,
      row: {
        name: "Oolong",
        categoryId,
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 5,
        purchasePrice: null,
        retailPrice: null,
        unitPrice: null,
        visible: true,
      },
    });
  });

  it("projects a batch insert with a movement id and a null note", () => {
    const projected = projectCreateBatch(contextWith(), {
      productId,
      batchNumber: " B9 ",
      packQuantity: 4,
      unitQuantity: 2,
    });
    expect(projected.row.rowVersion).toBe(1);
    expect(projected.writes[0]).toEqual({
      entity: "batch",
      action: "upsert",
      id: "generated-1",
      expectedRowVersion: null,
      movementId: "generated-2",
      note: null,
      row: {
        productId,
        batchNumber: "B9",
        expiresAt: null,
        packQuantity: 4,
        unitQuantity: 2,
      },
    });
  });

  it("keeps a supplied note on a batch update", () => {
    const context = contextWith({ batches: collectionOf([emptyBatch]) });
    const projected = projectUpdateBatch(context, {
      id: batchId,
      batchNumber: "B1",
      expiresAt: null,
      packQuantity: 7,
      note: "Recount",
    });
    expect(projected.row.rowVersion).toBe(3);
    expect(projected.writes[0]).toMatchObject({
      expectedRowVersion: 2,
      note: "Recount",
      row: { packQuantity: 7, unitQuantity: 0 },
    });
  });

  it("reuses an existing product id and its row version for an import line", () => {
    const projected = projectImportInventory(contextWith(), {
      categoryId,
      lines: [{ productId, name: "Green", unitsPerPack: 10, packQuantity: 2 }],
    });
    expect(projected.createdProducts).toBe(0);
    expect(projected.chunks[0]?.[0]).toMatchObject({
      entity: "product",
      id: productId,
      expectedRowVersion: 2,
    });
    expect(projected.chunks[0]?.[1]).toMatchObject({
      entity: "batch",
      expectedRowVersion: null,
      row: { productId, packQuantity: 2, unitQuantity: 0 },
    });
  });
});
