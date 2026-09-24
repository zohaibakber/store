import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";

import type {
  D1Database,
  D1DatabaseSession,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
} from "@cloudflare/workers-types";
import * as Schema from "effect/Schema";

const decodeBindValues = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Union([Schema.Null, Schema.Number, Schema.BigInt, Schema.String, Schema.Uint8Array]),
  ),
);

const nextTurn = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

interface Executed {
  readonly rows: ReadonlyArray<Record<string, SQLOutputValue>>;
  readonly columns: ReadonlyArray<string>;
  readonly changes: number;
  readonly lastRowId: number;
}

const resultOf = <T>(executed: Executed): D1Result<T> => ({
  success: true,
  meta: {
    duration: 0,
    size_after: 0,
    rows_read: executed.rows.length,
    rows_written: executed.changes,
    last_row_id: executed.lastRowId,
    changed_db: executed.changes > 0,
    changes: executed.changes,
  },
  // SAFETY: D1 leaves row typing to the caller; these are the untyped rows D1 would return.
  results: executed.rows.map((row) => row as T),
});

class SqliteStatement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly params: ReadonlyArray<SQLInputValue> = [],
  ) {}

  bind(...values: Array<unknown>): D1PreparedStatement {
    return new SqliteStatement(this.database, this.query, decodeBindValues(values));
  }

  execute(): Executed {
    const statement = this.database.prepare(this.query);
    const columns = statement.columns().map((column) => column.name);
    if (columns.length === 0) {
      const outcome = statement.run(...this.params);
      return {
        rows: [],
        columns,
        changes: Number(outcome.changes),
        lastRowId: Number(outcome.lastInsertRowid),
      };
    }
    const rows = statement.all(...this.params);
    const changes = this.database.prepare("SELECT changes() AS changes").get();
    return { rows, columns, changes: Number(changes?.changes ?? 0), lastRowId: 0 };
  }

  first<T>(): Promise<T | null> {
    return Promise.reject(new Error("first() is not used by D1Client."));
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  async all<T>(): Promise<D1Result<T>> {
    await nextTurn();
    return resultOf<T>(this.execute());
  }

  raw<T = Array<unknown>>(options: { columnNames: true }): Promise<[Array<string>, ...Array<T>]>;
  raw<T = Array<unknown>>(options?: { columnNames?: false }): Promise<Array<T>>;
  async raw<T>(options?: {
    columnNames?: boolean;
  }): Promise<[Array<string>, ...Array<T>] | Array<T>> {
    await nextTurn();
    const executed = this.execute();
    const values = executed.rows.map(
      // SAFETY: D1 leaves row typing to the caller; each row becomes its column values in order.
      (row) => executed.columns.map((column) => row[column]) as T,
    );
    return options?.columnNames ? [[...executed.columns], ...values] : values;
  }
}

class SqliteD1 implements D1Database {
  constructor(readonly database: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database, query);
  }

  async batch<T>(statements: Array<D1PreparedStatement>): Promise<Array<D1Result<T>>> {
    await nextTurn();
    const owned = statements.filter(
      (statement): statement is SqliteStatement => statement instanceof SqliteStatement,
    );
    if (owned.length !== statements.length) {
      throw new Error("The batch contains a statement from another database.");
    }
    this.database.exec("BEGIN");
    try {
      const results = owned.map((statement) => resultOf<T>(statement.execute()));
      this.database.exec("COMMIT");
      return results;
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    await nextTurn();
    this.database.exec(query);
    return { count: 1, duration: 0 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("Sessions are not used by the auth Worker.");
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("dump() is not used by the auth Worker."));
  }
}

const migrationsRoot = new URL("../../../packages/db/migrations/auth/", import.meta.url);

export const authD1 = () => {
  const database = new DatabaseSync(":memory:");
  for (const directory of readdirSync(migrationsRoot).sort()) {
    database.exec(readFileSync(new URL(`${directory}/migration.sql`, migrationsRoot), "utf8"));
  }
  return new SqliteD1(database);
};
