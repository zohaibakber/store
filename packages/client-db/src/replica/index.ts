export { analyzeInventorySubset } from "./subset-ir";
export { InventorySubsetSpec, SubsetPredicate, SubsetScalar } from "./subset-spec";
export {
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodeStockMovementSqliteRows,
} from "./decode";
export { ReplicaRowInvalid, UnsupportedSubsetQuery } from "./errors";
export { touchedEntitiesForCommand, touchedKeysForCommand } from "./enqueue";
export { openElectronIpcReplicaHandle } from "./electron-ipc-handle";
export type { ElectronReplicaBridge, ElectronReplicaOpenIdentity } from "./electron-ipc-handle";
export { openIndexedDbReplicaHandle } from "./indexeddb-handle";
export type { OpenIndexedDbReplicaInput } from "./indexeddb-handle";
export { indexedDbReplicaDatabaseName } from "@store/sync/replica/migrate-pending";
export { inventoryReplicaScope } from "./scope";
export { createInvoiceCoherenceGate, sqliteCollectionOptions } from "./collection";
export { DEFAULT_COLLECTION_MAXIMUM_ROWS, MAX_LIKE_PATTERN_LENGTH } from "./sources";
export type { InventoryCollectionSource, InventoryCollectionSyncMode } from "./sources";
export { syncHealthFromScheduler, syncStatusFromOutbox, syncStatusWithHealth } from "./status";
export {
  commandTargets,
  EMPTY_SYNC_ACTIVITY,
  rejectedCommandFromOutbox,
  syncActivityFromOutbox,
  syncActivityFromStatuses,
  syncStatusFromActivity,
} from "./activity";
export type {
  CommandTargets,
  InventorySyncActivity,
  RejectedCommand,
  RejectedCommandTarget,
} from "./activity";
export type { InventorySyncStatus, ReplicaSyncHealth } from "./status";
export type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaActivitySurface,
  ReplicaChangeFeed,
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaQueryStamp,
  ReplicaSubsetRead,
  ReplicaSubsetReader,
  ReplicaSyncHealthFeed,
  SqliteParameter,
  SqliteResultRow,
} from "./types";
