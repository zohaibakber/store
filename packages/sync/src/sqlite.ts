import type { EmptyRelations } from "drizzle-orm";
import type { BetterSQLite3Database, BetterSQLiteTransaction } from "drizzle-orm/better-sqlite3";

/** Database or in-transaction handle. Command code uses this; hosts keep the Database for `.transaction()`. */
export type SqliteConnection = BetterSQLite3Database | BetterSQLiteTransaction<EmptyRelations>;

export type SqliteDatabase = BetterSQLite3Database;

export type SqliteWriteQuery = {
  readonly run: () => void;
};

export const runWrite = (query: SqliteWriteQuery): void => {
  query.run();
};

export const runSqliteTransaction = <A>(
  db: SqliteDatabase,
  run: (tx: SqliteConnection) => A,
): A => {
  // SAFETY: better-sqlite3 commits before returning. Drizzle types a generic callback
  // result as possibly a Promise because SQLiteAsyncDatabase is shared with async
  // drivers, so `as never` selects the sync overload and `as A` restores the value.
  return db.transaction((tx) => run(tx) as never) as A;
};
