import type { MobileSyncOperation } from "@/lib/mobile-sync-queue";

export type SyncEntity = "category" | "product" | "batch" | "stockMovement";

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type SyncEntityChange = {
  entity: SyncEntity;
  action: "upsert";
  entityId: string;
  rowVersion: number;
  row: object;
};

export type SyncOperation = MobileSyncOperation<SyncEntityChange>;

export type StoredMutationState = {
  version: 1;
  organizationId: string;
  deviceId: string;
  nextClientSequence: number;
  pendingOperations: Array<SyncOperation>;
};

export type InventoryState = {
  organizationId: string;
  cacheKey: string;
  cursor: number;
  maps: import("@/lib/product-sync-state").ProductSyncMaps;
  mutationState: StoredMutationState | null;
};

export type StoredInventoryContext = {
  version: 1;
  userId: string;
  organizationId: string;
};

export type MobileCategory = {
  id: string;
  name: string;
  tracksPacks: boolean;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type MobileBatch = {
  id: string;
  productId: string;
  batchNumber: string | null;
  expiresAt: number | null;
  packQuantity: number;
  unitQuantity: number;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type MobileProduct = {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  tracksPacks: boolean;
  composition: string | null;
  strength: string | null;
  details: string;
  aisle: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  unitPrice: number | null;
  visible: boolean;
  stock: number;
  stockLabel: string;
  batches: ReadonlyArray<MobileBatch>;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type InventorySnapshot = {
  products: ReadonlyArray<MobileProduct>;
  categories: ReadonlyArray<MobileCategory>;
};

export type ProductMutationTarget =
  | { productId: string; newProductId?: never }
  | { productId?: null; newProductId: string };

export type BatchMutationTarget =
  | { batchId: string; newBatchId?: never }
  | { batchId?: null; newBatchId: string };

export type SaveScannedProductInput = ProductMutationTarget & {
  name: string;
  categoryId?: string;
  aisle?: string | null;
  composition?: string | null;
  strength?: string | null;
  unitsPerPack?: number;
  packPrice?: number | null;
  unitPrice?: number | null;
  visible?: boolean;
};

export type SaveBatchDetailsInput = BatchMutationTarget & {
  productId: string;
  batchNumber: string | null;
  expiresAt: number | null;
};

export type UpdateBatchQuantityInput = BatchMutationTarget & {
  productId: string;
  packQuantity: number;
  unitQuantity: number;
  batchNumber?: string | null;
  expiresAt?: number | null;
};
