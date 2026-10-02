export { LocalAuthority, LOCAL_AUTHORITY_EPOCH } from "./local-authority";
export {
  judgeMigrationLedger,
  LEGACY_LEDGER_TABLE as REPLICA_LEGACY_LEDGER_TABLE,
  MIGRATIONS_TABLE as REPLICA_LEDGER_TABLE,
} from "./migrations";
export { sqlitePartitionDigest } from "./replica/digest";
export { runReplicaTransaction, SqliteReplica } from "./replica/sql-client/handle";
export type { SqliteReplicaHandle } from "./replica/sql-client/handle";
export type { ReplicaDb } from "./replica/sql-client/drizzle";
export { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "./replica/sqlite/activity";
export { sqliteCatalogParts, type CatalogPart } from "./replica/sqlite/catalog-parts";
export { layerSqliteReplicaStore } from "./replica/sqlite/store";
export type { SqliteReplicaStoreOptions } from "./replica/sqlite/store";
