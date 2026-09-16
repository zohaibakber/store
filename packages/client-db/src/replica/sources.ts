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

export const NAMED_PROJECTION_NAMES = [
  "productList",
  "productStock",
  "invoiceList",
  "invoiceStock",
  "suggestions",
  "dashboard",
] as const;

export type NamedProjectionName = (typeof NAMED_PROJECTION_NAMES)[number];

export type InventoryCollectionSyncMode = "eager" | "on-demand";

export const SOURCE_TABLE = {
  categories: "categories",
  products: "products",
  batches: "batches",
  invoices: "invoices",
  invoiceItems: "invoice_items",
  stockMovements: "stock_movements",
} satisfies Record<InventoryCollectionSource, string>;

export const SOURCE_ENTITY = {
  categories: "category",
  products: "product",
  batches: "batch",
  invoices: "invoice",
  invoiceItems: "invoiceItem",
  stockMovements: "stockMovement",
} satisfies Record<InventoryCollectionSource, SyncEntity>;

export const FILTER_COLUMNS = {
  categories: new Set(["id", "organizationId", "name", "updatedAt", "deletedAt", "tracksPacks"]),
  products: new Set(["id", "organizationId", "categoryId", "updatedAt", "deletedAt", "visible"]),
  batches: new Set(["id", "organizationId", "productId", "expiresAt", "deletedAt"]),
  invoices: new Set([
    "id",
    "organizationId",
    "invoiceNumber",
    "operationId",
    "createdAt",
    "deletedAt",
  ]),
  invoiceItems: new Set(["id", "organizationId", "invoiceId", "productId", "batchId", "deletedAt"]),
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
  products: new Set(["id", "categoryId", "updatedAt"]),
  batches: new Set(["id", "productId", "expiresAt"]),
  invoices: new Set(["id", "invoiceNumber", "operationId", "createdAt"]),
  invoiceItems: new Set(["id", "invoiceId"]),
  stockMovements: new Set(["id", "productId", "batchId", "invoiceId", "operationId", "createdAt"]),
} satisfies Record<InventoryCollectionSource, ReadonlySet<string>>;

export const HISTORY_SOURCES: ReadonlySet<InventoryCollectionSource> = new Set([
  "invoices",
  "invoiceItems",
  "stockMovements",
]);

export const MAX_IN_VALUES = 32;

export const DEFAULT_COLLECTION_MAXIMUM_ROWS = 500;
