import {
  assertCanChangeUnitsPerPack,
  assertCanDeleteBatch,
  assertCanDeleteCategory,
  assertCanDeleteProduct,
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

import { persistableRow, type BatchRow, type CategoryRow, type ProductRow } from "./rows";

export type CatalogActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

export type CatalogWriteIds = {
  readonly now: () => number;
  readonly operationId: () => string;
  readonly rowId: () => string;
};

export const CATALOG_IMPORT_ROWS_PER_LINE = 2;

export const CATALOG_IMPORT_LINES_PER_COMMAND = Math.floor(
  MAX_CATALOG_WRITE_ROWS / CATALOG_IMPORT_ROWS_PER_LINE,
);

export type CatalogReadableCollection<Row extends { readonly id: string }> = {
  readonly state: {
    get: (id: string) => Row | undefined;
    values: () => Iterable<Row>;
  };
};

export type CatalogProjectionTables = {
  readonly batches: CatalogReadableCollection<BatchRow>;
  readonly categories: CatalogReadableCollection<CategoryRow>;
  readonly products: CatalogReadableCollection<ProductRow>;
};

export type CatalogProjectionContext = {
  readonly actor: CatalogActor;
  readonly commandId: string;
  readonly occurredAt: number;
  readonly ids: CatalogWriteIds;
  readonly tables: CatalogProjectionTables;
};

export type CatalogRowProjection<Row> = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
  readonly row: Row;
};

export type CatalogDeleteProjection = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
};

export type CatalogImportProjection = {
  readonly chunks: ReadonlyArray<ReadonlyArray<CatalogRowWrite>>;
  readonly createdProducts: number;
  readonly createdBatches: number;
};

const requiredRow = <Row>(row: Row | undefined, label: string): Row => {
  if (!row) throw new Error(`${label} no longer exists.`);
  return row;
};

const requireNonNegativeQuantity = (quantity: number, label: string) => {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
};

const insertMetadata = (context: CatalogProjectionContext) =>
  ({
    organizationId: context.actor.organizationId,
    createdByUserId: context.actor.userId,
    updatedByUserId: context.actor.userId,
    deviceId: context.actor.deviceId,
    operationId: context.commandId,
    rowVersion: 1,
    createdAt: context.occurredAt,
    updatedAt: context.occurredAt,
  }) as const;

const updateMetadata = (context: CatalogProjectionContext, rowVersion: number) =>
  ({
    updatedByUserId: context.actor.userId,
    deviceId: context.actor.deviceId,
    operationId: context.commandId,
    rowVersion: rowVersion + 1,
    updatedAt: context.occurredAt,
  }) as const;

const activeCategory = (tables: CatalogProjectionTables, categoryId: string) => {
  const category = tables.categories.state.get(categoryId);
  if (!category) throw new Error("Select an active category.");
  return category;
};

const activeProduct = (tables: CatalogProjectionTables, productId: string) => {
  const product = tables.products.state.get(productId);
  if (!product) throw new Error("This product no longer exists.");
  return product;
};

const categoryFieldsOf = (row: CategoryRow) => ({
  name: row.name,
  tracksPacks: row.tracksPacks,
});

const productFieldsOf = (row: ProductRow) => ({
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
): CatalogRowProjection<CategoryRow> => {
  const name = input.name.trim();
  if (!name) throw new Error("Enter a category name.");
  const duplicate = [...context.tables.categories.state.values()].find(
    (category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (duplicate) return { writes: [], row: persistableRow(duplicate) };
  const row: CategoryRow = {
    id: decodeCategoryId(input.id ?? context.ids.rowId()),
    name,
    tracksPacks: input.tracksPacks ?? true,
    ...insertMetadata(context),
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
};

export const projectUpdateCategory = (
  context: CatalogProjectionContext,
  input: UpdateCategoryInput,
): CatalogRowProjection<CategoryRow> => {
  const current = requiredRow(context.tables.categories.state.get(input.id), "This category");
  const name = input.name.trim();
  if (!name) throw new Error("Enter a category name.");
  const duplicate = [...context.tables.categories.state.values()].find(
    (category) =>
      category.id !== input.id &&
      category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (duplicate) throw new Error(`A category named “${name}” already exists.`);
  const row: CategoryRow = persistableRow({
    ...current,
    name,
    tracksPacks: input.tracksPacks,
    ...updateMetadata(context, current.rowVersion),
  });
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
};

export const projectDeleteCategory = (
  context: CatalogProjectionContext,
  id: UpdateCategoryInput["id"],
): CatalogDeleteProjection => {
  const current = requiredRow(context.tables.categories.state.get(id), "This category");
  assertCanDeleteCategory(context.tables.products.state.values(), id);
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
};

export const projectCreateProduct = (
  context: CatalogProjectionContext,
  input: CreateProductInput & { readonly id?: string },
): CatalogRowProjection<ProductRow> => {
  if (!input.categoryId) throw new Error("Select an active category.");
  const category = activeCategory(context.tables, input.categoryId);
  const name = input.name.trim();
  if (!name) throw new Error("Enter a product name.");
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
    ...insertMetadata(context),
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
};

export const projectUpdateProduct = (
  context: CatalogProjectionContext,
  input: UpdateProductInput,
): CatalogRowProjection<ProductRow> => {
  const current = requiredRow(context.tables.products.state.get(input.id), "This product");
  const category = activeCategory(context.tables, input.categoryId ?? current.categoryId);
  const unitsPerPack = input.unitsPerPack ?? 1;
  if (unitsPerPack !== current.unitsPerPack) {
    assertCanChangeUnitsPerPack(context.tables.batches.state.values(), current.id);
  }
  const row: ProductRow = persistableRow({
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
    ...updateMetadata(context, current.rowVersion),
  });
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
};

export const projectDeleteProduct = (
  context: CatalogProjectionContext,
  id: UpdateProductInput["id"],
): CatalogDeleteProjection => {
  const current = requiredRow(context.tables.products.state.get(id), "This product");
  assertCanDeleteProduct(context.tables.batches.state.values(), current.id);
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
};

export const projectCreateBatch = (
  context: CatalogProjectionContext,
  input: CreateBatchInput & { readonly id?: string; readonly note?: string | null },
): CatalogRowProjection<BatchRow> => {
  const product = activeProduct(context.tables, input.productId);
  const packQuantity = input.packQuantity ?? 0;
  const unitQuantity = input.unitQuantity ?? 0;
  requireNonNegativeQuantity(packQuantity, "Pack quantity");
  requireNonNegativeQuantity(unitQuantity, "Unit quantity");
  const row: BatchRow = {
    id: decodeBatchId(input.id ?? context.ids.rowId()),
    productId: product.id,
    batchNumber: input.batchNumber?.trim() || null,
    expiresAt: input.expiresAt ?? null,
    packQuantity,
    unitQuantity,
    ...insertMetadata(context),
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
};

export const projectUpdateBatch = (
  context: CatalogProjectionContext,
  input: UpdateBatchInput & { readonly note?: string | null },
): CatalogRowProjection<BatchRow> => {
  const current = requiredRow(context.tables.batches.state.get(input.id), "This batch");
  if (input.packQuantity !== undefined) {
    requireNonNegativeQuantity(input.packQuantity, "Pack quantity");
  }
  if (input.unitQuantity !== undefined) {
    requireNonNegativeQuantity(input.unitQuantity, "Unit quantity");
  }
  const row: BatchRow = persistableRow({
    ...current,
    batchNumber: input.batchNumber?.trim() || null,
    expiresAt: input.expiresAt,
    packQuantity: input.packQuantity ?? current.packQuantity,
    unitQuantity: input.unitQuantity ?? current.unitQuantity,
    ...updateMetadata(context, current.rowVersion),
  });
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
};

export const projectDeleteBatch = (
  context: CatalogProjectionContext,
  id: BatchRow["id"],
): CatalogDeleteProjection => {
  const current = requiredRow(context.tables.batches.state.get(id), "This batch");
  assertCanDeleteBatch(current);
  return {
    writes: [
      {
        entity: "batch",
        action: "delete",
        id: current.id,
        expectedRowVersion: current.rowVersion,
      },
    ],
  };
};

export type CatalogImportContext = {
  readonly ids: CatalogWriteIds;
  readonly tables: CatalogProjectionTables;
};

export const projectImportInventory = (
  context: CatalogImportContext,
  input: ImportInventoryInput,
): CatalogImportProjection => {
  if (input.lines.length === 0) throw new Error("Add at least one line to the import.");
  const category = activeCategory(context.tables, input.categoryId);
  const chunks: Array<Array<CatalogRowWrite>> = [];
  let createdProducts = 0;
  let current: Array<CatalogRowWrite> = [];

  for (const line of input.lines) {
    if (current.length >= CATALOG_IMPORT_LINES_PER_COMMAND * CATALOG_IMPORT_ROWS_PER_LINE) {
      chunks.push(current);
      current = [];
    }
    const name = line.name.trim();
    if (!name) throw new Error("Every imported line needs a product name.");
    const packQuantity = line.packQuantity ?? 0;
    const unitQuantity = line.unitQuantity ?? 0;
    requireNonNegativeQuantity(packQuantity, "Pack quantity");
    requireNonNegativeQuantity(unitQuantity, "Unit quantity");
    const existing = line.productId
      ? requiredRow(context.tables.products.state.get(line.productId), "This product")
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
        categoryId: category.id,
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
};
