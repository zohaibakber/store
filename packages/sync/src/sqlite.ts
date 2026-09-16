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

const SAVEPOINT_NAME = /^[a-z][a-z0-9_]*$/u;

export class SqliteTransactionAborted extends Error {
  readonly name = "SqliteTransactionAborted";
}

export const runSqlSavepoint = <A>(tx: SqliteConnection, name: string, run: () => A): A => {
  if (!SAVEPOINT_NAME.test(name)) {
    throw new Error("The savepoint name is not a safe identifier.");
  }
  tx.run(`SAVEPOINT ${name}`);
  try {
    const value = run();
    tx.run(`RELEASE ${name}`);
    return value;
  } catch (cause) {
    try {
      tx.run(`ROLLBACK TO ${name}`);
      tx.run(`RELEASE ${name}`);
    } catch {
      throw new SqliteTransactionAborted("The sqlite transaction was aborted.", { cause });
    }
    throw cause;
  }
};

type TransactionOutcome<A> = {
  readonly value: A;
};

export const runSqliteTransaction = <A>(db: SqliteDatabase, run: (tx: SqliteConnection) => A): A =>
  db.transaction((tx): TransactionOutcome<A> => ({ value: run(tx) })).value;
