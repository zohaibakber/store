import * as Schema from "effect/Schema";
import { expect, test } from "vitest";

import {
  assertCanChangeUnitsPerPack,
  assertCanDeleteCategory,
  assertCanDeleteProduct,
  catalogWriteError,
  productHasRemainingStock,
} from "../../src/catalog/rules";
import { CatalogWriteCommand } from "../../src/catalog/write";

test("a catalog write command requires at least one row", () => {
  expect(
    Schema.is(CatalogWriteCommand)({
      operationId: "operation-1",
      organizationId: "org-1",
      deviceId: "device-1",
      actorUserId: "user-1",
      occurredAt: 1,
      entity: "category",
      rows: [],
    }),
  ).toBe(false);
});

test("stocked products cannot be deleted or have their pack size changed", () => {
  const batches = [
    {
      productId: "product-1",
      deletedAt: null,
      packQuantity: 1,
      unitQuantity: 0,
    },
  ];
  expect(productHasRemainingStock(batches, "product-1")).toBe(true);
  expect(() => assertCanDeleteProduct(batches, "product-1")).toThrow(
    catalogWriteError.productHasStock,
  );
  expect(() => assertCanChangeUnitsPerPack(batches, "product-1")).toThrow(
    catalogWriteError.unitsPerPackWithStock,
  );
  expect(() =>
    assertCanDeleteCategory([{ categoryId: "category-1", deletedAt: null }], "category-1"),
  ).toThrow(catalogWriteError.categoryHasProducts);
});
