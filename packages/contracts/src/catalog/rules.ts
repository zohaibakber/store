import * as Result from "effect/Result";

import { CatalogRefusal } from "../catalog/refusal";

export const catalogWriteError = {
  categoryHasProducts: "Move products to another category before deleting this category.",
  productHasStock: "Clear remaining stock before deleting this product.",
  unitsPerPackWithStock: "Change units per pack only after the product has no remaining stock.",
  batchHasStock: "Clear remaining stock before deleting this batch.",
} as const;

type CatalogStockBatch = {
  readonly productId: string;
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

type CatalogCategoryProduct = {
  readonly categoryId: string;
};

const batchHasRemainingStock = (batch: {
  readonly packQuantity: number;
  readonly unitQuantity: number;
}) => batch.packQuantity > 0 || batch.unitQuantity > 0;

const productHasRemainingStock = (batches: Iterable<CatalogStockBatch>, productId: string) =>
  [...batches].some((batch) => batch.productId === productId && batchHasRemainingStock(batch));

const categoryHasActiveProducts = (
  products: Iterable<CatalogCategoryProduct>,
  categoryId: string,
) => [...products].some((product) => product.categoryId === categoryId);

export const checkCanDeleteCategory = (
  products: Iterable<CatalogCategoryProduct>,
  categoryId: string,
) =>
  Result.gen(function* () {
    if (categoryHasActiveProducts(products, categoryId)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "categoryHasProducts",
          message: catalogWriteError.categoryHasProducts,
        }),
      );
    }
  });

export const checkCanDeleteProduct = (batches: Iterable<CatalogStockBatch>, productId: string) =>
  Result.gen(function* () {
    if (productHasRemainingStock(batches, productId)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "productHasStock",
          message: catalogWriteError.productHasStock,
        }),
      );
    }
  });

export const checkCanChangeUnitsPerPack = (
  batches: Iterable<CatalogStockBatch>,
  productId: string,
) =>
  Result.gen(function* () {
    if (productHasRemainingStock(batches, productId)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "unitsPerPackWithStock",
          message: catalogWriteError.unitsPerPackWithStock,
          field: "unitsPerPack",
        }),
      );
    }
  });

export const checkCanDeleteBatch = (batch: {
  readonly packQuantity: number;
  readonly unitQuantity: number;
}) =>
  Result.gen(function* () {
    if (batchHasRemainingStock(batch)) {
      return yield* Result.fail(
        new CatalogRefusal({ reason: "batchHasStock", message: catalogWriteError.batchHasStock }),
      );
    }
  });

export const createdMutationMetadata = (
  actor: {
    readonly organizationId: string;
    readonly userId: string;
    readonly deviceId: string;
  },
  ids: { readonly now: () => number; readonly operationId: () => string } = {
    now: Date.now,
    operationId: () => crypto.randomUUID(),
  },
) => {
  const now = ids.now();
  return {
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: actor.deviceId,
    operationId: ids.operationId(),
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as const;
};

export const updatedMutationMetadata = (
  actor: {
    readonly userId: string;
    readonly deviceId: string;
    readonly rowVersion: number;
  },
  ids: { readonly now: () => number; readonly operationId: () => string } = {
    now: Date.now,
    operationId: () => crypto.randomUUID(),
  },
) => ({
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: ids.operationId(),
  rowVersion: actor.rowVersion + 1,
  updatedAt: ids.now(),
});
