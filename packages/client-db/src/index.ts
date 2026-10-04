export {
  makeCatalogCommands,
  type CatalogCommands,
  type CommandExecution,
  type ImportInventoryRequest,
} from "./catalog-commands";
export { readLearnedSuppliers, readOpenOrderLines, type OpenOrderLines } from "./catalog-read";
export type { CatalogActor } from "./projection-context";
export type {
  PurchaseOrderLineInput,
  ReceivedDelivery,
  ReceiveDeliveryInput,
  ReceiveDeliveryLineInput,
  SavedPurchaseOrder,
  SaveOrderDraftInput,
  SaveSupplierInput,
} from "./purchasing-projection";
export {
  containsText,
  InventorySubsetSpec,
  InventorySubsetSummary,
  InventorySubsetSummarySpec,
  SubsetPredicate,
} from "./replica/subset-spec";
export {
  decodeBatchSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
} from "./replica/decode";
export { openElectronIpcReplicaHandle } from "./replica/electron-ipc-handle";
export type { ElectronReplicaBridge } from "./replica/electron-ipc-handle";
export {
  indexedDbReplicaDatabaseName,
  inventoryReplicaScope,
  REPLICA_STORAGE_PREFIX,
  sqliteReplicaFileName,
} from "./replica/naming";
export { catalogCollectionOptions } from "./replica/collection";
export {
  accumulateNotice,
  mergeAccumulators,
  noticeAffects,
  type NoticeAccumulator,
} from "./replica/collection-notices";
export { NOTICE_BUFFER_CAPACITY, offerCoalescing } from "./replica/notice-coalescing";
export { DEFAULT_COLLECTION_MAXIMUM_ROWS, MAX_IN_VALUES } from "./replica/sources";
export { syncStatusFromOutbox, syncStatusWithHealth } from "./replica/status";
export {
  EMPTY_SYNC_ACTIVITY,
  rejectedCommandLabel,
  rejectedCommandSubject,
  rejectionReason,
  replicaSyncActivityOf,
  ReplicaSyncActivity,
} from "./replica/activity";
export type {
  InventorySyncActivity,
  RejectedCommand,
  RejectedCommandLabel,
  RejectedCommandSubject,
  RejectedCommandTarget,
} from "./replica/activity";
export type { InventorySyncStatus, ReplicaSyncHealth, SyncTransfer } from "./replica/status";
export type {
  ReplicaAnalytics,
  ReplicaChangeFeed,
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaSummaryReader,
  ReplicaSubsetReader,
} from "./replica/types";
export * from "./rows";
