import type { OfflineStoreApi } from "@store/contracts";

export type StoreMethod = Exclude<keyof OfflineStoreApi, "onSyncStatusChange">;

export const STORE_CHANNELS = {
  listCategories: "store:categories:list",
  createCategory: "store:categories:create",
  updateCategory: "store:categories:update",
  deleteCategory: "store:categories:delete",
  listProducts: "store:products:list",
  listCompositions: "store:products:compositions",
  searchProducts: "store:products:search",
  getProduct: "store:products:get",
  createProduct: "store:products:create",
  updateProduct: "store:products:update",
  deleteProduct: "store:products:delete",
  createBatch: "store:batches:create",
  updateBatch: "store:batches:update",
  importInventory: "store:inventory:import",
  listStockMovements: "store:stock-movements:list",
  listInvoices: "store:invoices:list",
  getInvoice: "store:invoices:get",
  createInvoice: "store:invoices:create",
  getDashboardAnalytics: "store:analytics:dashboard",
  getSyncStatus: "store:sync:status",
  sync: "store:sync:run",
} as const satisfies Record<StoreMethod, string>;

export const STORE_SYNC_STATUS_CHANNEL = "store:sync:status-changed";
