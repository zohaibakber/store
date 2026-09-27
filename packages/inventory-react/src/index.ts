export type {
  InventorySyncActivity,
  InventorySyncStatus,
  RejectedCommand,
  RejectedCommandTarget,
} from "@store/client-db";
export {
  configureInventoryPreferences,
  minuteClockAtom,
  stockPolicyAtom,
  type CommandExecutionState,
} from "./atoms";
export { CatalogOpenFailure, StaleCatalogLease } from "./errors";
export type { InventoryHost, InventoryScope, ReplicaOpenIdentity } from "./host";
export {
  createAppCatalogLifetime,
  createCatalogLifetime,
  type CatalogLease,
  type CatalogLifetime,
  type CatalogReplica,
} from "./lifetime";
export { inventoryScopeId, openInventoryWorkspace } from "./open";
export {
  InventoryProvider,
  useCatalogIsReady,
  useCatalogReplica,
  useCommandExecution,
  useInventoryActions,
  useInventoryState,
  useInventorySyncActivity,
  useInventorySyncStatus,
} from "./provider";
export {
  useCatalogCategories,
  useCatalogProduct,
  useCatalogProducts,
  useCatalogProductSearch,
  useCatalogStockMovements,
  useCatalogSuggestions,
  useInventoryInvoice,
  useInventoryInvoices,
  usePendingRowIds,
} from "./queries";
export {
  matchCatalogProducts,
  summarizeProductStock,
  type CatalogProductSearchResult,
  type ProductStockSummary,
  type SearchableProduct,
} from "./search";
export {
  useInventoryInsights,
  useProductInsight,
  useProductInsightIndex,
  useStockPolicy,
  type InsightsState,
} from "./insights";
export { inventorySyncStatusLabel } from "./sync-status";
export type { Inventory, InventoryActions, InventoryState } from "./types";
