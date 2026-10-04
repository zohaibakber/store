import type { SyncEntity } from "@store/contracts";

export const INVENTORY_COLLECTION_SOURCES = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoiceItems",
  "stockMovements",
  "suppliers",
  "purchaseOrders",
  "purchaseOrderItems",
] as const;

export type InventoryCollectionSource = (typeof INVENTORY_COLLECTION_SOURCES)[number];

export const SOURCE_ENTITY = {
  categories: "category",
  products: "product",
  batches: "batch",
  invoices: "invoice",
  invoiceItems: "invoiceItem",
  stockMovements: "stockMovement",
  suppliers: "supplier",
  purchaseOrders: "purchaseOrder",
  purchaseOrderItems: "purchaseOrderItem",
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
  invoices: new Set([
    "id",
    "organizationId",
    "invoiceNumber",
    "customerName",
    "operationId",
    "createdAt",
  ]),
  invoiceItems: new Set(["id", "organizationId", "invoiceId", "productId", "batchId"]),
  stockMovements: new Set([
    "id",
    "organizationId",
    "productId",
    "batchId",
    "invoiceId",
    "purchaseOrderId",
    "operationId",
    "createdAt",
  ]),
  suppliers: new Set(["id", "organizationId", "name", "updatedAt"]),
  purchaseOrders: new Set([
    "id",
    "organizationId",
    "orderNumber",
    "supplierId",
    "status",
    "createdAt",
    "updatedAt",
  ]),
  purchaseOrderItems: new Set([
    "id",
    "organizationId",
    "purchaseOrderId",
    "productId",
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
  suppliers: new Set(["id", "name", "updatedAt"]),
  purchaseOrders: new Set(["id", "orderNumber", "supplierId", "status", "createdAt", "updatedAt"]),
  purchaseOrderItems: new Set(["id", "purchaseOrderId", "productId", "createdAt"]),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const CASE_INSENSITIVE_ORDER_COLUMNS = {
  categories: new Set<string>(),
  products: new Set(["name", "aisle"]),
  batches: new Set<string>(),
  invoices: new Set<string>(),
  invoiceItems: new Set<string>(),
  stockMovements: new Set<string>(),
  suppliers: new Set<string>(),
  purchaseOrders: new Set<string>(),
  purchaseOrderItems: new Set<string>(),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export { MAX_IN_VALUES } from "@store/contracts/replica";

export const MAX_LIKE_PATTERN_LENGTH = 256;

export const LIKE_ESCAPE = "\\";

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
  suppliers: new Set<string>(),
  purchaseOrders: new Set<string>(),
  purchaseOrderItems: new Set<string>(),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const MAX_DISTINCT_COLUMNS = 5;

export const MAX_DISTINCT_VALUES = 500;
