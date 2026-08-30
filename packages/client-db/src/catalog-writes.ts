import {
  assertCanChangeUnitsPerPack,
  assertCanDeleteCategory,
  assertCanDeleteProduct,
  createdMutationMetadata,
  updatedMutationMetadata,
} from "@store/contracts/catalog-rules";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateProductInput,
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

type Mutable<Row> = { -readonly [K in keyof Row]: Row[K] };

export type PersistableCollection<Row extends { readonly id: string }> = {
  readonly state: {
    get: (id: string) => Row | undefined;
    values: () => Iterable<Row>;
  };
  insert: (row: Row) => { readonly isPersisted: { readonly promise: Promise<unknown> } };
  update: (
    id: string,
    updater: (draft: Mutable<Row>) => void,
  ) => { readonly isPersisted: { readonly promise: Promise<unknown> } };
};

export type CatalogWriteTables = {
  readonly batches: PersistableCollection<BatchRow>;
  readonly categories: PersistableCollection<CategoryRow>;
  readonly products: PersistableCollection<ProductRow>;
};

const defaultIds: CatalogWriteIds = {
  now: Date.now,
  operationId: () => crypto.randomUUID(),
  rowId: () => crypto.randomUUID(),
};

const requiredRow = <Row>(row: Row | undefined, label: string): Row => {
  if (!row) throw new Error(`${label} no longer exists.`);
  return row;
};

const activeRows = <Row extends { readonly deletedAt: number | null }>(rows: Iterable<Row>) =>
  [...rows].filter((row) => row.deletedAt === null);

const requireNonNegativeQuantity = (quantity: number, label: string) => {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
};

export const makeCatalogWrites = (
  tables: CatalogWriteTables,
  actor: CatalogActor,
  ids: CatalogWriteIds = defaultIds,
) => {
  const created = () => createdMutationMetadata(actor, ids);
  const updated = (rowVersion: number) => updatedMutationMetadata({ ...actor, rowVersion }, ids);

  return {
    createCategory: async (input: CreateCategoryInput & { readonly id?: string }) => {
      const name = input.name.trim();
      if (!name) throw new Error("Enter a category name.");
      const duplicate = activeRows(tables.categories.state.values()).find(
        (category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (duplicate) return duplicate;
      const row: CategoryRow = {
        id: decodeCategoryId(input.id ?? ids.rowId()),
        name,
        tracksPacks: input.tracksPacks ?? true,
        ...created(),
      };
      const transaction = tables.categories.insert(row);
      await transaction.isPersisted.promise;
      return row;
    },
    updateCategory: async (input: UpdateCategoryInput) => {
      const current = requiredRow(tables.categories.state.get(input.id), "This category");
      const name = input.name.trim();
      if (!name) throw new Error("Enter a category name.");
      const duplicate = activeRows(tables.categories.state.values()).find(
        (category) =>
          category.id !== input.id &&
          category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (duplicate) throw new Error(`A category named “${name}” already exists.`);
      const metadata = updated(current.rowVersion);
      const transaction = tables.categories.update(input.id, (draft) => {
        draft.name = name;
        draft.tracksPacks = input.tracksPacks;
        Object.assign(draft, metadata);
      });
      await transaction.isPersisted.promise;
      return { ...current, name, tracksPacks: input.tracksPacks, ...metadata };
    },
    deleteCategory: async (id: UpdateCategoryInput["id"]) => {
      const current = requiredRow(tables.categories.state.get(id), "This category");
      assertCanDeleteCategory(tables.products.state.values(), id);
      const metadata = updated(current.rowVersion);
      const transaction = tables.categories.update(id, (draft) => {
        draft.deletedAt = metadata.updatedAt;
        Object.assign(draft, metadata);
      });
      await transaction.isPersisted.promise;
    },
    createProduct: async (input: CreateProductInput & { readonly id?: string }) => {
      if (!input.categoryId) throw new Error("Select an active category.");
      const categoryId = decodeCategoryId(input.categoryId);
      const category = tables.categories.state.get(categoryId);
      if (!category || category.deletedAt !== null) throw new Error("Select an active category.");
      const row: ProductRow = {
        id: decodeProductId(input.id ?? ids.rowId()),
        name: input.name.trim(),
        categoryId,
        aisle: input.aisle ?? null,
        composition: input.composition ?? null,
        strength: input.strength ?? null,
        unitsPerPack: input.unitsPerPack ?? 1,
        purchasePrice: input.purchasePrice ?? null,
        retailPrice: input.retailPrice ?? null,
        unitPrice: input.unitPrice ?? null,
        visible: input.visible ?? true,
        ...created(),
      };
      const transaction = tables.products.insert(row);
      await transaction.isPersisted.promise;
      return row;
    },
    updateProduct: async (input: UpdateProductInput) => {
      const current = requiredRow(tables.products.state.get(input.id), "This product");
      const categoryId = decodeCategoryId(input.categoryId ?? current.categoryId);
      const category = tables.categories.state.get(categoryId);
      if (!category || category.deletedAt !== null) throw new Error("Select an active category.");
      const metadata = updated(current.rowVersion);
      const unitsPerPack = input.unitsPerPack ?? 1;
      if (unitsPerPack !== current.unitsPerPack) {
        assertCanChangeUnitsPerPack(tables.batches.state.values(), current.id);
      }
      const next = persistableRow({
        ...current,
        ...input,
        name: input.name.trim(),
        categoryId,
        aisle: input.aisle ?? null,
        composition: input.composition ?? null,
        strength: input.strength ?? null,
        unitsPerPack,
        purchasePrice: input.purchasePrice ?? null,
        retailPrice: input.retailPrice ?? null,
        unitPrice: input.unitPrice ?? null,
        visible: input.visible ?? true,
        ...metadata,
      } satisfies ProductRow);
      const transaction = tables.products.update(input.id, (draft) => Object.assign(draft, next));
      await transaction.isPersisted.promise;
      return next;
    },
    deleteProduct: async (id: UpdateProductInput["id"]) => {
      const current = requiredRow(tables.products.state.get(id), "This product");
      assertCanDeleteProduct(tables.batches.state.values(), current.id);
      const metadata = updated(current.rowVersion);
      const transaction = tables.products.update(id, (draft) => {
        draft.deletedAt = metadata.updatedAt;
        Object.assign(draft, metadata);
      });
      await transaction.isPersisted.promise;
    },
    createBatch: async (input: CreateBatchInput & { readonly id?: string }) => {
      const product = tables.products.state.get(input.productId);
      if (!product || product.deletedAt !== null) throw new Error("This product no longer exists.");
      const packQuantity = input.packQuantity ?? 0;
      const unitQuantity = input.unitQuantity ?? 0;
      requireNonNegativeQuantity(packQuantity, "Pack quantity");
      requireNonNegativeQuantity(unitQuantity, "Unit quantity");
      const row: BatchRow = {
        id: decodeBatchId(input.id ?? ids.rowId()),
        productId: decodeProductId(input.productId),
        batchNumber: input.batchNumber?.trim() || null,
        expiresAt: input.expiresAt ?? null,
        packQuantity,
        unitQuantity,
        ...created(),
      };
      const transaction = tables.batches.insert(row);
      await transaction.isPersisted.promise;
      return row;
    },
    updateBatch: async (input: UpdateBatchInput) => {
      const current = requiredRow(tables.batches.state.get(input.id), "This batch");
      if (input.packQuantity !== undefined) {
        requireNonNegativeQuantity(input.packQuantity, "Pack quantity");
      }
      if (input.unitQuantity !== undefined) {
        requireNonNegativeQuantity(input.unitQuantity, "Unit quantity");
      }
      const metadata = updated(current.rowVersion);
      const next = persistableRow({
        ...current,
        batchNumber: input.batchNumber?.trim() || null,
        expiresAt: input.expiresAt,
        packQuantity: input.packQuantity ?? current.packQuantity,
        unitQuantity: input.unitQuantity ?? current.unitQuantity,
        ...metadata,
      } satisfies BatchRow);
      const transaction = tables.batches.update(input.id, (draft) => Object.assign(draft, next));
      await transaction.isPersisted.promise;
      return next;
    },
  };
};

export type CatalogWrites = ReturnType<typeof makeCatalogWrites>;
