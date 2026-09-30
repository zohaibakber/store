import type { SyncEntity } from "@store/contracts";

export const INVENTORY_COLLECTION_SOURCES = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoiceItems",
  "stockMovements",
] as const;

export type InventoryCollectionSource = (typeof INVENTORY_COLLECTION_SOURCES)[number];

export type InventoryCollectionSyncMode = "eager" | "on-demand";

export const SOURCE_ENTITY = {
  categories: "category",
  products: "product",
  batches: "batch",
  invoices: "invoice",
  invoiceItems: "invoiceItem",
  stockMovements: "stockMovement",
} satisfies Record<InventoryCollectionSource, SyncEntity>;

export const FILTER_COLUMNS = {
  categories: new Set(["id", "organizationId", "name", "updatedAt", "tracksPacks"]),
  products: new Set([
    "id",
    "organizationId",
    "categoryId",
    "updatedAt",
    "visible",
    "name",
    "aisle",
    "composition",
    "strength",
  ]),
  batches: new Set(["id", "organizationId", "productId", "expiresAt"]),
  invoices: new Set(["id", "organizationId", "invoiceNumber", "operationId", "createdAt"]),
  invoiceItems: new Set(["id", "organizationId", "invoiceId", "productId", "batchId"]),
  stockMovements: new Set([
    "id",
    "organizationId",
    "productId",
    "batchId",
    "invoiceId",
    "operationId",
    "createdAt",
  ]),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const ORDER_COLUMNS = {
  categories: new Set(["id", "name", "updatedAt"]),
  products: new Set([
    "id",
    "name",
    "categoryId",
    "aisle",
    "unitsPerPack",
    "purchasePrice",
    "retailPrice",
    "unitPrice",
    "updatedAt",
  ]),
  batches: new Set(["id", "productId", "expiresAt"]),
  invoices: new Set(["id", "invoiceNumber", "operationId", "createdAt"]),
  invoiceItems: new Set(["id", "invoiceId"]),
  stockMovements: new Set(["id", "productId", "batchId", "invoiceId", "operationId", "createdAt"]),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const CASE_INSENSITIVE_ORDER_COLUMNS = {
  categories: new Set<string>(),
  products: new Set(["name", "aisle"]),
  batches: new Set<string>(),
  invoices: new Set<string>(),
  invoiceItems: new Set<string>(),
  stockMovements: new Set<string>(),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const MAX_IN_VALUES = 200;

export const MAX_LIKE_PATTERN_LENGTH = 256;

export const DEFAULT_COLLECTION_MAXIMUM_ROWS = 500;

export const MAX_BATCH_SPECS = 6;

export const MAX_BATCH_ROWS = 500;

export const DISTINCT_COLUMNS = {
  categories: new Set<string>(),
  products: new Set(["categoryId", "name", "aisle", "composition", "strength"]),
  batches: new Set<string>(),
  invoices: new Set<string>(),
  invoiceItems: new Set<string>(),
  stockMovements: new Set<string>(),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const MAX_DISTINCT_COLUMNS = 5;

export const MAX_DISTINCT_VALUES = 500;
