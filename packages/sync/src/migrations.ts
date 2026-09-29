import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";

const LEDGER_TABLE = "__store_sync_migrations";

const decodeLedgerRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ key: Schema.String })),
);

const byKey = Order.mapInput(Order.String, ([key]: readonly [string, string]) => key);

const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

export const runMigrations = Effect.fn("ReplicaMigrations.run")(function* (
  sql: SqlClient,
  migrations: Record<string, string>,
) {
  yield* sql.unsafe(`create table if not exists ${LEDGER_TABLE} (key text primary key not null)`);
  const ledger = yield* sql
    .unsafe(`select key from ${LEDGER_TABLE}`)
    .pipe(Effect.flatMap(decodeLedgerRows), Effect.orDie);
  const applied = new Set(ledger.map((row) => row.key));
  for (const [key, migration] of Arr.sort(Object.entries(migrations), byKey)) {
    if (applied.has(key)) continue;
    for (const statement of migrationStatements(migration)) {
      yield* sql.unsafe(statement);
    }
    yield* sql.unsafe(`insert into ${LEDGER_TABLE} (key) values (?)`, [key]);
  }
});
