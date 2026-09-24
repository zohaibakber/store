import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";

const LEDGER_TABLE = "__store_sync_migrations";

const MIGRATION_KEY_PATTERN = /^[0-9a-z_]+$/u;

export class SyncMigrationKeyInvalid extends Schema.TaggedError<SyncMigrationKeyInvalid>()(
  "SyncMigrationKeyInvalid",
  { key: Schema.String },
) {}

export type SqliteMigrationTarget<E> = {
  readonly execute: (
    statement: string,
    parameters: ReadonlyArray<string>,
  ) => Effect.Effect<void, E>;
  readonly appliedKeys: (statement: string) => Effect.Effect<ReadonlyArray<string>, E>;
};

export const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const LedgerRows = Schema.Array(Schema.Struct({ key: Schema.String }));

const decodeLedgerRows = Schema.decodeUnknownSync(LedgerRows);

export const sqlClientMigrationTarget = (sql: SqlClient): SqliteMigrationTarget<SqlError> => ({
  execute: (statement, parameters) => Effect.asVoid(sql.unsafe(statement, parameters)),
  appliedKeys: (statement) =>
    sql.unsafe(statement).pipe(Effect.map((rows) => decodeLedgerRows(rows).map((row) => row.key))),
});

export const runMigrations = <E>(
  migrations: Record<string, string>,
  target: SqliteMigrationTarget<E>,
): Effect.Effect<void, E | SyncMigrationKeyInvalid> =>
  Effect.gen(function* () {
    yield* target.execute(
      `create table if not exists ${LEDGER_TABLE} (key text primary key not null)`,
      [],
    );
    const applied = new Set(yield* target.appliedKeys(`select key from ${LEDGER_TABLE}`));
    for (const key of Object.keys(migrations).sort()) {
      if (applied.has(key)) continue;
      if (!MIGRATION_KEY_PATTERN.test(key)) {
        return yield* Effect.fail(new SyncMigrationKeyInvalid({ key }));
      }
      const migration = migrations[key];
      if (migration === undefined) continue;
      for (const statement of migrationStatements(migration)) {
        yield* target.execute(statement, []);
      }
      yield* target.execute(`insert into ${LEDGER_TABLE} (key) values (?)`, [key]);
    }
  });
