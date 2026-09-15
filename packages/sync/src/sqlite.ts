import type { EmptyRelations } from "drizzle-orm";
import type { SQLiteAsyncDatabase, SQLiteAsyncTransaction } from "drizzle-orm/sqlite-core";

export type SqliteDatabase = SQLiteAsyncDatabase<"sync", unknown, EmptyRelations>;

export type SqliteConnection =
  | SQLiteAsyncDatabase<"sync", unknown, EmptyRelations>
  | SQLiteAsyncTransaction<"sync", unknown, EmptyRelations>;

export type SqliteWriteQuery = {
  readonly run: () => void;
};

export const runWrite = (query: SqliteWriteQuery): void => {
  query.run();
};

type TransactionOutcome<A> = {
  readonly value: A;
};

export const runSqliteTransaction = <A>(db: SqliteDatabase, run: (tx: SqliteConnection) => A): A =>
  db.transaction((tx): TransactionOutcome<A> => ({ value: run(tx) })).value;
