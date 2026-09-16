export { useInventoryDashboardAnalytics } from "./dashboard";
export { inventoryScopeId, openInventoryWorkspace } from "./open";
export {
  InventoryProvider,
  InventoryReady,
  useInventoryActions,
  useCatalogIsReady,
} from "./provider";
export {
  useCatalogCategories,
  useCatalogProduct,
  useCatalogProducts,
  useCatalogStockMovements,
  useCatalogSuggestions,
  useInventoryInvoice,
  useInventoryInvoices,
} from "./queries";
export type { InventoryActions } from "./types";
