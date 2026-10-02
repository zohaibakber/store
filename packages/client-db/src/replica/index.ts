export {
  containsText,
  InventorySubsetSpec,
  InventorySubsetSummary,
  InventorySubsetSummarySpec,
  SubsetPredicate,
} from "./subset-spec";
export { decodeBatchSqliteRows, decodeInvoiceSqliteRows, decodeProductSqliteRows } from "./decode";
export { openElectronIpcReplicaHandle } from "./electron-ipc-handle";
export type { ElectronReplicaBridge } from "./electron-ipc-handle";
export { openIndexedDbReplicaHandle } from "./indexeddb-handle";
export {
  indexedDbReplicaDatabaseName,
  REPLICA_STORAGE_PREFIX,
  sqliteReplicaFileName,
} from "@store/sync/replica/storage-name";
export { inventoryReplicaScope } from "./scope";
export { catalogCollectionOptions } from "./collection";
export {
  accumulateNotice,
  mergeAccumulators,
  noticeAffects,
  type NoticeAccumulator,
} from "./collection-notices";
export { NOTICE_BUFFER_CAPACITY, offerCoalescing } from "./notice-coalescing";
export { DEFAULT_COLLECTION_MAXIMUM_ROWS, MAX_IN_VALUES } from "./sources";
export { syncStatusFromOutbox, syncStatusWithHealth } from "./status";
export {
  EMPTY_SYNC_ACTIVITY,
  rejectedCommandLabel,
  rejectedCommandSubject,
  rejectionReason,
  replicaSyncActivityOf,
  ReplicaSyncActivity,
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
  ReplicaAnalytics,
  ReplicaChangeFeed,
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaSummaryReader,
  ReplicaSubsetReader,
  SqliteResultRow,
} from "./types";
