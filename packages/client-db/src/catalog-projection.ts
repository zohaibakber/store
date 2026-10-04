import { CatalogRefusal } from "@store/contracts/catalog-refusal";
import {
  checkCanChangeUnitsPerPack,
  checkCanDeleteCategory,
  checkCanDeleteProduct,
  createdMutationMetadata,
  updatedMutationMetadata,
} from "@store/contracts/catalog-rules";
import { MAX_CATALOG_WRITE_ROWS, type CatalogRowWrite } from "@store/contracts/catalog-write";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateProductInput,
  ImportInventoryInput,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts/store.schema";
import * as Result from "effect/Result";

import {
  commandIds,
  requiredRow,
  type CatalogReadableCollection,
  type CatalogWriteIds,
  type ProjectionContext,
} from "./projection-context";
import type { BatchRow, CategoryRow, ProductRow } from "./rows";

const CATALOG_IMPORT_ROWS_PER_LINE = 2;

const CATALOG_IMPORT_LINES_PER_COMMAND = Math.floor(
  MAX_CATALOG_WRITE_ROWS / CATALOG_IMPORT_ROWS_PER_LINE,
);

export type CatalogProjectionTables = {
  readonly batches: CatalogReadableCollection<BatchRow>;
  readonly categories: CatalogReadableCollection<CategoryRow>;
  readonly products: CatalogReadableCollection<ProductRow>;
};

export type CatalogProjectionContext = ProjectionContext<CatalogProjectionTables>;

type CatalogRowProjection<Row> = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
  readonly row: Row;
};

type CatalogDeleteProjection = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
};

type CatalogImportProjection = {
  readonly chunks: ReadonlyArray<ReadonlyArray<CatalogRowWrite>>;
  readonly createdProducts: number;
  readonly createdBatches: number;
};

const requireNonNegativeQuantity = (quantity: number, label: string, field?: string) =>
  Result.gen(function* () {
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      const message = `${label} must be a non-negative whole number.`;
      return yield* Result.fail(
        field === undefined
          ? new CatalogRefusal({ reason: "invalidInput", message })
          : new CatalogRefusal({ reason: "invalidInput", message, field }),
      );
    }
  });

const activeCategory = (tables: CatalogProjectionTables, categoryId: string) =>
  Result.gen(function* () {
    const category = tables.categories.state.get(categoryId);
    if (!category)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "missingReference",
          message: "Select an active category.",
          field: "categoryId",
        }),
      );
    return category;
  });

const activeProduct = (tables: CatalogProjectionTables, productId: string) =>
  Result.gen(function* () {
    const product = tables.products.state.get(productId);
    if (!product)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "missingReference",
          message: "This product no longer exists.",
        }),
      );
    return product;
  });

const categoryFieldsOf = (row: CategoryRow) => ({
  name: row.name,
  tracksPacks: row.tracksPacks,
});

export const productFieldsOf = (row: ProductRow) => ({
  name: row.name,
  categoryId: row.categoryId,
  aisle: row.aisle,
  composition: row.composition,
  strength: row.strength,
  unitsPerPack: row.unitsPerPack,
  purchasePrice: row.purchasePrice,
  retailPrice: row.retailPrice,
  unitPrice: row.unitPrice,
  visible: row.visible,
});

const batchFieldsOf = (row: BatchRow) => ({
  productId: row.productId,
  batchNumber: row.batchNumber,
  expiresAt: row.expiresAt === 0 ? null : row.expiresAt,
  packQuantity: row.packQuantity,
  unitQuantity: row.unitQuantity,
});

export const projectCreateCategory = (
  context: CatalogProjectionContext,
  input: CreateCategoryInput & { readonly id?: string },
): Result.Result<CatalogRowProjection<CategoryRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const name = input.name.trim();
    if (!name)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: "Enter a category name.",
          field: "name",
        }),
      );
    const duplicate = [...context.tables.categories.state.values()].find(
      (category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) return { writes: [], row: duplicate };
    const row: CategoryRow = {
      id: decodeCategoryId(input.id ?? context.ids.rowId()),
      name,
      tracksPacks: input.tracksPacks ?? true,
      ...createdMutationMetadata(context.actor, commandIds(context)),
    };
    return {
      writes: [
        {
          entity: "category",
          action: "upsert",
          id: row.id,
          expectedRowVersion: null,
          row: categoryFieldsOf(row),
        },
      ],
      row,
    };
  });

export const projectUpdateCategory = (
  context: CatalogProjectionContext,
  input: UpdateCategoryInput,
): Result.Result<CatalogRowProjection<CategoryRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(
      context.tables.categories.state.get(input.id),
      "This category",
    );
    const name = input.name.trim();
    if (!name)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: "Enter a category name.",
          field: "name",
        }),
      );
    const duplicate = [...context.tables.categories.state.values()].find(
      (category) =>
        category.id !== input.id &&
        category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "duplicateName",
          message: `A category named “${name}” already exists.`,
          field: "name",
        }),
      );
    const row: CategoryRow = {
      ...current,
      name,
      tracksPacks: input.tracksPacks,
      ...updatedMutationMetadata(
        { ...context.actor, rowVersion: current.rowVersion },
        commandIds(context),
      ),
    };
    return {
      writes: [
        {
          entity: "category",
          action: "upsert",
          id: row.id,
          expectedRowVersion: current.rowVersion,
          row: categoryFieldsOf(row),
        },
      ],
      row,
    };
  });

export const projectDeleteCategory = (
  context: CatalogProjectionContext,
  id: UpdateCategoryInput["id"],
): Result.Result<CatalogDeleteProjection, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(context.tables.categories.state.get(id), "This category");
    yield* checkCanDeleteCategory(context.tables.products.state.values(), id);
    return {
      writes: [
        {
          entity: "category",
          action: "delete",
          id: current.id,
          expectedRowVersion: current.rowVersion,
        },
      ],
    };
  });

export const projectCreateProduct = (
  context: CatalogProjectionContext,
  input: CreateProductInput & { readonly id?: string },
): Result.Result<CatalogRowProjection<ProductRow>, CatalogRefusal> =>
  Result.gen(function* () {
    if (!input.categoryId)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "missingReference",
          message: "Select an active category.",
          field: "categoryId",
        }),
      );
    const category = yield* activeCategory(context.tables, input.categoryId);
    const name = input.name.trim();
    if (!name)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: "Enter a product name.",
          field: "name",
        }),
      );
    const row: ProductRow = {
      id: decodeProductId(input.id ?? context.ids.rowId()),
      name,
      categoryId: category.id,
      aisle: input.aisle ?? null,
      composition: input.composition ?? null,
      strength: input.strength ?? null,
      unitsPerPack: input.unitsPerPack ?? 1,
      purchasePrice: input.purchasePrice ?? null,
      retailPrice: input.retailPrice ?? null,
      unitPrice: input.unitPrice ?? null,
      visible: input.visible ?? true,
      ...createdMutationMetadata(context.actor, commandIds(context)),
    };
    return {
      writes: [
        {
          entity: "product",
          action: "upsert",
          id: row.id,
          expectedRowVersion: null,
          row: productFieldsOf(row),
        },
      ],
      row,
    };
  });

export const projectUpdateProduct = (
  context: CatalogProjectionContext,
  input: UpdateProductInput,
): Result.Result<CatalogRowProjection<ProductRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(context.tables.products.state.get(input.id), "This product");
    const category = yield* activeCategory(context.tables, input.categoryId ?? current.categoryId);
    const unitsPerPack = input.unitsPerPack ?? 1;
    if (unitsPerPack !== current.unitsPerPack) {
      yield* checkCanChangeUnitsPerPack(context.tables.batches.state.values(), current.id);
    }
    const row: ProductRow = {
      ...current,
      name: input.name.trim(),
      categoryId: category.id,
      aisle: input.aisle ?? null,
      composition: input.composition ?? null,
      strength: input.strength ?? null,
      unitsPerPack,
      purchasePrice: input.purchasePrice ?? null,
      retailPrice: input.retailPrice ?? null,
      unitPrice: input.unitPrice ?? null,
      visible: input.visible ?? true,
      ...updatedMutationMetadata(
        { ...context.actor, rowVersion: current.rowVersion },
        commandIds(context),
      ),
    };
    return {
      writes: [
        {
          entity: "product",
          action: "upsert",
          id: row.id,
          expectedRowVersion: current.rowVersion,
          row: productFieldsOf(row),
        },
      ],
      row,
    };
  });

export const projectDeleteProduct = (
  context: CatalogProjectionContext,
  id: UpdateProductInput["id"],
): Result.Result<CatalogDeleteProjection, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(context.tables.products.state.get(id), "This product");
    yield* checkCanDeleteProduct(context.tables.batches.state.values(), current.id);
    return {
      writes: [
        {
          entity: "product",
          action: "delete",
          id: current.id,
          expectedRowVersion: current.rowVersion,
        },
      ],
    };
  });

export const projectCreateBatch = (
  context: CatalogProjectionContext,
  input: CreateBatchInput & { readonly id?: string; readonly note?: string | null },
): Result.Result<CatalogRowProjection<BatchRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const product = yield* activeProduct(context.tables, input.productId);
    const packQuantity = input.packQuantity ?? 0;
    const unitQuantity = input.unitQuantity ?? 0;
    yield* requireNonNegativeQuantity(packQuantity, "Pack quantity", "packQuantity");
    yield* requireNonNegativeQuantity(unitQuantity, "Unit quantity", "unitQuantity");
    const row: BatchRow = {
      id: decodeBatchId(input.id ?? context.ids.rowId()),
      productId: product.id,
      batchNumber: input.batchNumber?.trim() || null,
      expiresAt: input.expiresAt ?? null,
      packQuantity,
      unitQuantity,
      ...createdMutationMetadata(context.actor, commandIds(context)),
    };
    return {
      writes: [
        {
          entity: "batch",
          action: "upsert",
          id: row.id,
          expectedRowVersion: null,
          movementId: context.ids.rowId(),
          note: input.note ?? null,
          row: batchFieldsOf(row),
        },
      ],
      row,
    };
  });

export const projectUpdateBatch = (
  context: CatalogProjectionContext,
  input: UpdateBatchInput & { readonly note?: string | null },
): Result.Result<CatalogRowProjection<BatchRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(context.tables.batches.state.get(input.id), "This batch");
    if (input.packQuantity !== undefined) {
      yield* requireNonNegativeQuantity(input.packQuantity, "Pack quantity", "packQuantity");
    }
    if (input.unitQuantity !== undefined) {
      yield* requireNonNegativeQuantity(input.unitQuantity, "Unit quantity", "unitQuantity");
    }
    const row: BatchRow = {
      ...current,
      batchNumber: input.batchNumber?.trim() || null,
      expiresAt: input.expiresAt,
      packQuantity: input.packQuantity ?? current.packQuantity,
      unitQuantity: input.unitQuantity ?? current.unitQuantity,
      ...updatedMutationMetadata(
        { ...context.actor, rowVersion: current.rowVersion },
        commandIds(context),
      ),
    };
    return {
      writes: [
        {
          entity: "batch",
          action: "upsert",
          id: row.id,
          expectedRowVersion: current.rowVersion,
          movementId: context.ids.rowId(),
          note: input.note ?? null,
          row: batchFieldsOf(row),
        },
      ],
      row,
    };
  });

type CatalogImportContext = {
  readonly ids: CatalogWriteIds;
  readonly tables: CatalogProjectionTables;
};

export const projectImportInventory = (
  context: CatalogImportContext,
  input: ImportInventoryInput,
): Result.Result<CatalogImportProjection, CatalogRefusal> =>
  Result.gen(function* () {
    if (input.lines.length === 0)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "emptyCommand",
          message: "Add at least one line to the import.",
        }),
      );
    const category = yield* activeCategory(context.tables, input.categoryId);
    const chunks: Array<Array<CatalogRowWrite>> = [];
    let createdProducts = 0;
    let current: Array<CatalogRowWrite> = [];

    for (const line of input.lines) {
      if (current.length >= CATALOG_IMPORT_LINES_PER_COMMAND * CATALOG_IMPORT_ROWS_PER_LINE) {
        chunks.push(current);
        current = [];
      }
      const name = line.name.trim();
      if (!name)
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "invalidInput",
            message: "Every imported line needs a product name.",
          }),
        );
      const packQuantity = line.packQuantity ?? 0;
      const unitQuantity = line.unitQuantity ?? 0;
      yield* requireNonNegativeQuantity(packQuantity, "Pack quantity");
      yield* requireNonNegativeQuantity(unitQuantity, "Unit quantity");
      const existing = line.productId
        ? yield* requiredRow(context.tables.products.state.get(line.productId), "This product")
        : undefined;
      const productId = existing ? existing.id : decodeProductId(context.ids.rowId());
      if (!existing) createdProducts += 1;
      current.push({
        entity: "product",
        action: "upsert",
        id: productId,
        expectedRowVersion: existing ? existing.rowVersion : null,
        row: {
          ...(existing ? productFieldsOf(existing) : null),
          name,
          categoryId: existing?.categoryId ?? category.id,
          aisle: existing?.aisle ?? null,
          composition: existing?.composition ?? null,
          strength: existing?.strength ?? null,
          unitsPerPack: line.unitsPerPack ?? existing?.unitsPerPack ?? 1,
          purchasePrice: line.purchasePrice ?? existing?.purchasePrice ?? null,
          retailPrice: existing?.retailPrice ?? null,
          unitPrice: existing?.unitPrice ?? null,
          visible: existing?.visible ?? true,
        },
      });
      current.push({
        entity: "batch",
        action: "upsert",
        id: decodeBatchId(context.ids.rowId()),
        expectedRowVersion: null,
        movementId: context.ids.rowId(),
        note: null,
        row: {
          productId,
          batchNumber: line.batchNumber?.trim() || null,
          expiresAt: line.expiresAt ?? null,
          packQuantity,
          unitQuantity,
        },
      });
    }
    if (current.length > 0) chunks.push(current);

    return {
      chunks,
      createdProducts,
      createdBatches: input.lines.length,
    };
  });
