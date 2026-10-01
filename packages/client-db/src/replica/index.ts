export {
  InventorySubsetSpec,
  InventorySubsetSummary,
  InventorySubsetSummarySpec,
  SubsetPredicate,
} from "./subset-spec";
export {
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodePurchaseOrderItemSqliteRows,
  decodePurchaseOrderSqliteRows,
  decodeStockMovementSqliteRows,
  decodeSupplierSqliteRows,
} from "./decode";
export { openElectronIpcReplicaHandle } from "./electron-ipc-handle";
export type { ElectronReplicaBridge } from "./electron-ipc-handle";
export { openIndexedDbReplicaHandle } from "./indexeddb-handle";
export {
  indexedDbReplicaDatabaseName,
  REPLICA_STORAGE_PREFIX,
  sqliteReplicaFileName,
} from "@store/sync/replica/storage-name";
export { inventoryReplicaScope } from "./scope";
export { createInvoiceCoherenceGate, sqliteCollectionOptions } from "./collection";
export {
  accumulateNotice,
  mergeAccumulators,
  noticeAffects,
  type NoticeAccumulator,
} from "./collection-notices";
export { NOTICE_BUFFER_CAPACITY, offerCoalescing } from "./notice-coalescing";
export { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "./sources";
export { syncStatusFromOutbox, syncStatusWithHealth } from "./status";
export {
  EMPTY_SYNC_ACTIVITY,
  rejectedCommandLabel,
  rejectedCommandSubject,
  rejectionReason,
  syncActivityFromOutbox,
  syncActivityFromStatuses,
  syncStatusFromActivity,
} from "./activity";
export type {
  InventorySyncActivity,
  RejectedCommand,
  RejectedCommandLabel,
  RejectedCommandSubject,
  RejectedCommandTarget,
} from "./activity";
export type { InventorySyncStatus, ReplicaSyncHealth } from "./status";
export type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaAnalytics,
  ReplicaChangeFeed,
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaSummaryReader,
  ReplicaRow,
  ReplicaSubsetReader,
  SqliteResultRow,
} from "./types";
