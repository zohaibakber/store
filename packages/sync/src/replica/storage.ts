import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { REPLICA_SCHEMA_SQL } from "../authority/schema-sql";
import { runSqliteTransaction, type SqliteConnection, type SqliteDatabase } from "../sqlite";

export type ReplicaDb = SqliteConnection;

export type ReplicaStore = {
  readonly sqlite: Database.Database;
  readonly db: SqliteDatabase;
  readonly close: () => void;
};

export const openReplicaStore = (path = ":memory:"): ReplicaStore => {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(REPLICA_SCHEMA_SQL);
  const db = drizzle({ client: sqlite });
  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
};

export const runReplicaTransaction = <A>(db: SqliteDatabase, run: (tx: ReplicaDb) => A): A =>
  runSqliteTransaction(db, run);
