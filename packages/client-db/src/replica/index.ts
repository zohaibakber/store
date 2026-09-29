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
  decodeStockMovementSqliteRows,
} from "./decode";
export { touchedEntitiesForCommand, touchedKeysForCommand } from "./enqueue";
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
export { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "./sources";
export { syncStatusFromOutbox, syncStatusWithHealth } from "./status";
export {
  EMPTY_SYNC_ACTIVITY,
  syncActivityFromOutbox,
  syncActivityFromStatuses,
  syncStatusFromActivity,
} from "./activity";
export type { InventorySyncActivity, RejectedCommand, RejectedCommandTarget } from "./activity";
export type { InventorySyncStatus, ReplicaSyncHealth } from "./status";
export type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaChangeFeed,
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaSummaryReader,
  ReplicaSubsetReader,
  SqliteResultRow,
} from "./types";
