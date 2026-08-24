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
