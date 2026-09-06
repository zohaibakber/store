export const catalogWriteError = {
  categoryHasProducts: "Move products to another category before deleting this category.",
  productHasStock: "Clear remaining stock before deleting this product.",
  unitsPerPackWithStock: "Change units per pack only after the product has no remaining stock.",
  batchHasStock: "Clear remaining stock before deleting this batch.",
} as const;

export type CatalogStockBatch = {
  readonly productId: string;
  readonly deletedAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export type CatalogCategoryProduct = {
  readonly categoryId: string;
  readonly deletedAt: number | null;
};

export const batchHasRemainingStock = (batch: {
  readonly packQuantity: number;
  readonly unitQuantity: number;
}) => batch.packQuantity > 0 || batch.unitQuantity > 0;

export const productHasRemainingStock = (batches: Iterable<CatalogStockBatch>, productId: string) =>
  [...batches].some(
    (batch) =>
      batch.deletedAt === null && batch.productId === productId && batchHasRemainingStock(batch),
  );

export const categoryHasActiveProducts = (
  products: Iterable<CatalogCategoryProduct>,
  categoryId: string,
) =>
  [...products].some((product) => product.deletedAt === null && product.categoryId === categoryId);

export const assertCanDeleteCategory = (
  products: Iterable<CatalogCategoryProduct>,
  categoryId: string,
) => {
  if (categoryHasActiveProducts(products, categoryId)) {
    throw new Error(catalogWriteError.categoryHasProducts);
  }
};

export const assertCanDeleteProduct = (batches: Iterable<CatalogStockBatch>, productId: string) => {
  if (productHasRemainingStock(batches, productId)) {
    throw new Error(catalogWriteError.productHasStock);
  }
};

export const assertCanChangeUnitsPerPack = (
  batches: Iterable<CatalogStockBatch>,
  productId: string,
) => {
  if (productHasRemainingStock(batches, productId)) {
    throw new Error(catalogWriteError.unitsPerPackWithStock);
  }
};

export const assertCanDeleteBatch = (batch: {
  readonly packQuantity: number;
  readonly unitQuantity: number;
}) => {
  if (batchHasRemainingStock(batch)) {
    throw new Error(catalogWriteError.batchHasStock);
  }
};

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
    deletedAt: null,
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
