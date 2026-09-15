import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { REPLICA_SCHEMA_SQL } from "../authority/schema-sql";

export type ReplicaDb = BetterSQLite3Database;

export type ReplicaStore = {
  readonly sqlite: Database.Database;
  readonly db: ReplicaDb;
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

export const runReplicaTransaction = <A>(db: ReplicaDb, run: (tx: ReplicaDb) => A): A =>
  db.transaction((tx) => run(tx as ReplicaDb) as never) as A;
