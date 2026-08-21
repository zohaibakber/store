import * as Crypto from "expo-crypto";

import { mobileBatchById, mobileProductById, snapshotFromMaps } from "@/lib/inventory-snapshot";
import {
  commitLocalOperation,
  type InventoryAccess,
  loadWorkspaceInventoryState,
} from "@/lib/inventory-sync";
import type {
  BatchMutationTarget,
  MobileBatch,
  MobileProduct,
  ProductMutationTarget,
  SaveBatchDetailsInput,
  SaveScannedProductInput,
  SyncEntityChange,
  UpdateBatchQuantityInput,
} from "@/lib/inventory-types";
import type { BatchRow, CategoryRow, ProductRow, ProductSyncMaps } from "@/lib/product-sync-state";

const requireProduct = (maps: ProductSyncMaps, productId: string) => {
  const product = maps.products.get(productId);
  if (!product) throw new Error("The product no longer exists. Refresh and try again.");
  return product;
};

const requireBatch = (maps: ProductSyncMaps, productId: string, batchId: string) => {
  const batch = maps.batches.get(batchId);
  if (!batch || batch.productId !== productId)
    throw new Error("The batch no longer exists for this product. Refresh and try again.");
  return batch;
};

const requiredEntityId = (value: string | undefined, label: string) => {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200) throw new Error(`${label} is invalid.`);
  return normalized;
};

type ProductMutationResolution = { id: string; current: ProductRow | null };
type BatchMutationResolution = { id: string; current: BatchRow | null };

const resolveProductMutationTarget = (
  maps: ProductSyncMaps,
  input: ProductMutationTarget,
): ProductMutationResolution => {
  if (input.productId) {
    if (input.newProductId) throw new Error("Choose either an existing or a new product.");
    return { id: input.productId, current: requireProduct(maps, input.productId) };
  }

  const id = requiredEntityId(input.newProductId, "New product id");
  return { id, current: maps.products.get(id) ?? null };
};

const resolveBatchMutationTarget = (
  maps: ProductSyncMaps,
  productId: string,
  input: BatchMutationTarget,
): BatchMutationResolution => {
  if (input.batchId) {
    if (input.newBatchId) throw new Error("Choose either an existing or a new batch.");
    return { id: input.batchId, current: requireBatch(maps, productId, input.batchId) };
  }

  const id = requiredEntityId(input.newBatchId, "New batch id");
  const current = maps.batches.get(id) ?? null;
  if (current && current.productId !== productId)
    throw new Error("The saved batch belongs to a different product.");
  return { id, current };
};

const requiredName = (value: string) => {
  const normalized = value.trim();
  if (!normalized) throw new Error("Product name is required.");
  if (normalized.length > 120) throw new Error("Product name must be 120 characters or fewer.");
  return normalized;
};

const optionalText = (value: string | null, maximum: number, label: string) => {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maximum)
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return normalized;
};

const nonNegativeInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative whole number.`);
  return value;
};

const nullablePrice = (value: number | null, label: string) =>
  value === null ? null : nonNegativeInteger(value, label);

const expiryTimestamp = (value: number | null) => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0))
    throw new Error("Expiry date must be a valid timestamp.");
  return value;
};

const productChange = (
  id: string,
  rowVersion: number,
  row: Omit<ProductRow, "rowVersion" | "createdAt" | "updatedAt">,
): SyncEntityChange => ({ entity: "product", action: "upsert", entityId: id, rowVersion, row });

const categoryChange = (
  id: string,
  row: Omit<CategoryRow, "rowVersion" | "createdAt" | "updatedAt">,
): SyncEntityChange => ({ entity: "category", action: "upsert", entityId: id, rowVersion: 1, row });

const batchChange = (
  id: string,
  rowVersion: number,
  row: Omit<BatchRow, "rowVersion" | "createdAt" | "updatedAt">,
): SyncEntityChange => ({ entity: "batch", action: "upsert", entityId: id, rowVersion, row });

const movementChange = (input: {
  productId: string;
  batchId: string;
  type: "stock_in" | "adjustment";
  packDelta: number;
  unitDelta: number;
  note: string;
}): SyncEntityChange => {
  const id = Crypto.randomUUID();
  return {
    entity: "stockMovement",
    action: "upsert",
    entityId: id,
    rowVersion: 1,
    row: {
      id,
      productId: input.productId,
      batchId: input.batchId,
      invoiceId: null,
      type: input.type,
      packDelta: input.packDelta,
      unitDelta: input.unitDelta,
      note: input.note,
    },
  };
};

export const saveScannedProduct = (
  access: InventoryAccess,
  input: SaveScannedProductInput,
): Promise<MobileProduct> =>
  access.withLock(async () => {
    const state = await loadWorkspaceInventoryState(access);
    const { id, current } = resolveProductMutationTarget(state.maps, input);
    const inputCategoryId = input.categoryId?.trim() || undefined;
    const requestedCategoryId =
      inputCategoryId ?? current?.categoryId ?? state.maps.categories.keys().next().value;
    const createsGeneralCategory = !requestedCategoryId && state.maps.categories.size === 0;
    const categoryId = createsGeneralCategory ? "general" : requestedCategoryId;
    if (!categoryId || (!createsGeneralCategory && !state.maps.categories.has(categoryId)))
      throw new Error("Choose a category for this product.");
    const category = state.maps.categories.get(categoryId);
    const unitsPerPack =
      (category?.tracksPacks ?? true)
        ? nonNegativeInteger(input.unitsPerPack ?? current?.unitsPerPack ?? 1, "Units per pack")
        : 1;
    if (unitsPerPack < 1) throw new Error("Units per pack must be at least 1.");
    const row = {
      id,
      name: requiredName(input.name),
      categoryId,
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
      packPrice:
        (category?.tracksPacks ?? true)
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
    } satisfies Omit<ProductRow, "rowVersion" | "createdAt" | "updatedAt">;
    const changes = createsGeneralCategory
      ? [
          categoryChange("general", { id: "general", name: "General", tracksPacks: true }),
          productChange(id, (current?.rowVersion ?? 0) + 1, row),
        ]
      : [productChange(id, (current?.rowVersion ?? 0) + 1, row)];
    await commitLocalOperation(state, access.userId, changes);
    return mobileProductById(snapshotFromMaps(state.maps), id);
  });

export const saveBatchDetails = (
  access: InventoryAccess,
  input: SaveBatchDetailsInput,
): Promise<MobileBatch> =>
  access.withLock(async () => {
    const state = await loadWorkspaceInventoryState(access);
    requireProduct(state.maps, input.productId);
    const { id, current } = resolveBatchMutationTarget(state.maps, input.productId, input);
    const row = {
      id,
      productId: input.productId,
      batchNumber: optionalText(input.batchNumber, 64, "Batch number"),
      expiresAt: expiryTimestamp(input.expiresAt),
      packQuantity: current?.packQuantity ?? 0,
      unitQuantity: current?.unitQuantity ?? 0,
    } satisfies Omit<BatchRow, "rowVersion" | "createdAt" | "updatedAt">;
    await commitLocalOperation(state, access.userId, [
      batchChange(id, (current?.rowVersion ?? 0) + 1, row),
    ]);
    return mobileBatchById(snapshotFromMaps(state.maps), input.productId, id);
  });

export const updateBatchQuantity = (
  access: InventoryAccess,
  input: UpdateBatchQuantityInput,
): Promise<MobileBatch> =>
  access.withLock(async () => {
    const state = await loadWorkspaceInventoryState(access);
    const product = requireProduct(state.maps, input.productId);
    const category = state.maps.categories.get(product.categoryId);
    const { id, current } = resolveBatchMutationTarget(state.maps, input.productId, input);
    const requestedPackQuantity = nonNegativeInteger(input.packQuantity, "Pack quantity");
    const unitQuantity = nonNegativeInteger(input.unitQuantity, "Unit quantity");
    if (category?.tracksPacks === false && !current && requestedPackQuantity !== 0)
      throw new Error("This category tracks individual units, not packs.");
    const packQuantity =
      category?.tracksPacks === false ? (current?.packQuantity ?? 0) : requestedPackQuantity;

    if (!current && packQuantity + unitQuantity < 1)
      throw new Error("Add at least one pack or unit when creating stock.");
    const packDelta = packQuantity - (current?.packQuantity ?? 0);
    const unitDelta = unitQuantity - (current?.unitQuantity ?? 0);
    const row = {
      id,
      productId: input.productId,
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
    } satisfies Omit<BatchRow, "rowVersion" | "createdAt" | "updatedAt">;
    const changes: SyncEntityChange[] = [batchChange(id, (current?.rowVersion ?? 0) + 1, row)];
    if (packDelta !== 0 || unitDelta !== 0)
      changes.push(
        movementChange({
          productId: input.productId,
          batchId: id,
          type: current ? "adjustment" : "stock_in",
          packDelta,
          unitDelta,
          note: current ? "Stock corrected" : "Initial scanner stock",
        }),
      );

    await commitLocalOperation(state, access.userId, changes);
    return mobileBatchById(snapshotFromMaps(state.maps), input.productId, id);
  });
