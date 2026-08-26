import { persistableRow, type BatchRow, type CategoryRow, type ProductRow } from "@store/client-db";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import * as Crypto from "expo-crypto";

import type { MobileInventoryCollections } from "@/lib/inventory-collections";
import { mobileBatchById, mobileProductById, snapshotFromRows } from "@/lib/inventory-snapshot";
import type {
  MobileBatch,
  MobileProduct,
  SaveBatchDetailsInput,
  SaveScannedProductInput,
  UpdateBatchQuantityInput,
} from "@/lib/inventory-types";

type Actor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

const createdMetadata = (actor: Actor) => {
  const now = Date.now();
  return {
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: actor.deviceId,
    operationId: Crypto.randomUUID(),
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as const;
};

const updatedMetadata = (actor: Actor, rowVersion: number) => ({
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: Crypto.randomUUID(),
  rowVersion: rowVersion + 1,
  updatedAt: Date.now(),
});

const requiredName = (value: string) => {
  const normalized = value.trim();
  if (!normalized) throw new Error("Product name is required.");
  if (normalized.length > 120) throw new Error("Product name must be 120 characters or fewer.");
  return normalized;
};

const optionalText = (value: string | null, maximum: number, label: string) => {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
};

const nonNegativeInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
  return value;
};

const nullablePrice = (value: number | null, label: string) =>
  value === null ? null : nonNegativeInteger(value, label);

const expiryTimestamp = (value: number | null) => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Expiry date must be a valid timestamp.");
  }
  return value;
};

const snapshot = (collections: MobileInventoryCollections) =>
  snapshotFromRows({
    batches: [...collections.batches.state.values()].filter((row) => row.deletedAt === null),
    categories: [...collections.categories.state.values()].filter((row) => row.deletedAt === null),
    products: [...collections.products.state.values()].filter((row) => row.deletedAt === null),
  });

const requiredProduct = (collections: MobileInventoryCollections, productId: string) => {
  const product = collections.products.state.get(productId);
  if (!product || product.deletedAt !== null) {
    throw new Error("The product no longer exists. Refresh and try again.");
  }
  return product;
};

const requiredBatch = (
  collections: MobileInventoryCollections,
  productId: string,
  batchId: string,
) => {
  const batch = collections.batches.state.get(batchId);
  if (!batch || batch.deletedAt !== null || batch.productId !== productId) {
    throw new Error("The batch no longer exists for this product. Refresh and try again.");
  }
  return batch;
};

const saveProduct = async (
  collections: MobileInventoryCollections,
  actor: Actor,
  input: SaveScannedProductInput,
): Promise<MobileProduct> => {
  const id = decodeProductId(input.productId ?? input.newProductId);
  const current = input.productId ? requiredProduct(collections, input.productId) : null;
  let categoryId = input.categoryId?.trim() || current?.categoryId;
  const activeCategories = [...collections.categories.state.values()].filter(
    (row) => row.deletedAt === null,
  );
  if (!categoryId) categoryId = activeCategories[0]?.id;
  if (!categoryId && activeCategories.length === 0) {
    const general: CategoryRow = {
      id: decodeCategoryId(Crypto.randomUUID()),
      name: "General",
      tracksPacks: true,
      ...createdMetadata(actor),
    };
    const categoryTransaction = collections.categories.insert(general);
    await categoryTransaction.isPersisted.promise;
    categoryId = general.id;
  }
  const category = categoryId ? collections.categories.state.get(categoryId) : undefined;
  if (!category || category.deletedAt !== null)
    throw new Error("Choose a category for this product.");

  const unitsPerPack = category.tracksPacks
    ? nonNegativeInteger(input.unitsPerPack ?? current?.unitsPerPack ?? 1, "Units per pack")
    : 1;
  if (unitsPerPack < 1) throw new Error("Units per pack must be at least 1.");

  const values = {
    name: requiredName(input.name),
    categoryId: decodeCategoryId(category.id),
    aisle: optionalText(
      input.aisle === undefined ? (current?.aisle ?? null) : input.aisle,
      64,
      "Aisle",
    ),
    composition: optionalText(
      input.composition === undefined ? (current?.composition ?? null) : input.composition,
      160,
      "Composition",
    ),
    strength: optionalText(
      input.strength === undefined ? (current?.strength ?? null) : input.strength,
      20,
      "Strength",
    ),
    unitsPerPack,
    packPrice: category.tracksPacks
      ? nullablePrice(
          input.packPrice === undefined ? (current?.packPrice ?? null) : input.packPrice,
          "Pack price",
        )
      : null,
    unitPrice: nullablePrice(
      input.unitPrice === undefined ? (current?.unitPrice ?? null) : input.unitPrice,
      "Unit price",
    ),
    visible: input.visible ?? current?.visible ?? true,
  };

  if (current) {
    if (unitsPerPack !== current.unitsPerPack) {
      const remainingStock = [...collections.batches.state.values()].some(
        (batch) =>
          batch.deletedAt === null &&
          batch.productId === current.id &&
          (batch.packQuantity > 0 || batch.unitQuantity > 0),
      );
      if (remainingStock) {
        throw new Error("Change units per pack only after the product has no remaining stock.");
      }
    }
    const metadata = updatedMetadata(actor, current.rowVersion);
    const next = persistableRow({ ...current, ...values, ...metadata } satisfies ProductRow);
    const transaction = collections.products.update(id, (draft) => Object.assign(draft, next));
    await transaction.isPersisted.promise;
  } else {
    const row = { id, ...values, ...createdMetadata(actor) } satisfies ProductRow;
    const transaction = collections.products.insert(row);
    await transaction.isPersisted.promise;
  }
  return mobileProductById(snapshot(collections), id);
};

const saveBatch = async (
  collections: MobileInventoryCollections,
  actor: Actor,
  input: SaveBatchDetailsInput,
): Promise<MobileBatch> => {
  requiredProduct(collections, input.productId);
  const id = decodeBatchId(input.batchId ?? input.newBatchId);
  const current = input.batchId ? requiredBatch(collections, input.productId, input.batchId) : null;
  const values = {
    productId: decodeProductId(input.productId),
    batchNumber: optionalText(input.batchNumber, 64, "Batch number"),
    expiresAt: expiryTimestamp(input.expiresAt),
    packQuantity: current?.packQuantity ?? 0,
    unitQuantity: current?.unitQuantity ?? 0,
  };
  if (current) {
    const metadata = updatedMetadata(actor, current.rowVersion);
    const next = persistableRow({ ...current, ...values, ...metadata } satisfies BatchRow);
    const transaction = collections.batches.update(id, (draft) => Object.assign(draft, next));
    await transaction.isPersisted.promise;
  } else {
    const row = { id, ...values, ...createdMetadata(actor) } satisfies BatchRow;
    const transaction = collections.batches.insert(row);
    await transaction.isPersisted.promise;
  }
  return mobileBatchById(snapshot(collections), input.productId, id);
};

const saveQuantity = async (
  collections: MobileInventoryCollections,
  actor: Actor,
  input: UpdateBatchQuantityInput,
): Promise<MobileBatch> => {
  const product = requiredProduct(collections, input.productId);
  const category = collections.categories.state.get(product.categoryId);
  const id = decodeBatchId(input.batchId ?? input.newBatchId);
  const current = input.batchId ? requiredBatch(collections, input.productId, input.batchId) : null;
  const requestedPacks = nonNegativeInteger(input.packQuantity, "Pack quantity");
  const unitQuantity = nonNegativeInteger(input.unitQuantity, "Unit quantity");
  if (category?.tracksPacks === false && !current && requestedPacks !== 0) {
    throw new Error("This category tracks individual units, not packs.");
  }
  const packQuantity =
    category?.tracksPacks === false ? (current?.packQuantity ?? 0) : requestedPacks;
  if (!current && packQuantity + unitQuantity < 1) {
    throw new Error("Add at least one pack or unit when creating stock.");
  }
  const values = {
    productId: decodeProductId(input.productId),
    batchNumber: optionalText(
      input.batchNumber === undefined ? (current?.batchNumber ?? null) : input.batchNumber,
      64,
      "Batch number",
    ),
    expiresAt: expiryTimestamp(
      input.expiresAt === undefined ? (current?.expiresAt ?? null) : input.expiresAt,
    ),
    packQuantity,
    unitQuantity,
  };
  if (current) {
    const metadata = updatedMetadata(actor, current.rowVersion);
    const next = persistableRow({ ...current, ...values, ...metadata } satisfies BatchRow);
    const transaction = collections.batches.update(id, (draft) => Object.assign(draft, next));
    await transaction.isPersisted.promise;
  } else {
    const row = { id, ...values, ...createdMetadata(actor) } satisfies BatchRow;
    const transaction = collections.batches.insert(row);
    await transaction.isPersisted.promise;
  }
  return mobileBatchById(snapshot(collections), input.productId, id);
};

export const createMobileCatalogActions = (
  collections: MobileInventoryCollections,
  actor: Actor,
) => ({
  saveScannedProduct: (input: SaveScannedProductInput) => saveProduct(collections, actor, input),
  saveBatchDetails: (input: SaveBatchDetailsInput) => saveBatch(collections, actor, input),
  updateBatchQuantity: (input: UpdateBatchQuantityInput) => saveQuantity(collections, actor, input),
});
