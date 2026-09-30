import * as Effect from "effect/Effect";
import * as EffectRecord from "effect/Record";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/unstable/sql/Migrator";
import { SqlClient } from "effect/unstable/sql/SqlClient";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";

const MIGRATIONS_TABLE = "__store_replica_migrations";

const LEGACY_LEDGER_TABLE = "__store_sync_migrations";

const decodeKeyRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ key: Schema.String })),
);

const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const legacyAppliedKeys = Effect.fn("ReplicaMigrations.legacyAppliedKeys")(function* (
  sql: SqlClient,
) {
  const tables =
    yield* sql`select name from sqlite_master where type = 'table' and name = ${LEGACY_LEDGER_TABLE}`;
  if (tables.length === 0) return new Set<string>();
  const rows = yield* sql`select key from ${sql(LEGACY_LEDGER_TABLE)}`.pipe(
    Effect.flatMap(decodeKeyRows),
    Effect.orDie,
  );
  return new Set(rows.map((row) => row.key));
});

const runMigrator = Migrator.make({});

export const runMigrations = Effect.fn("ReplicaMigrations.run")(function* (
  sql: SqlClient,
  migrations: Record<string, string>,
) {
  const legacy = yield* legacyAppliedKeys(sql);
  yield* runMigrator({
    table: MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      EffectRecord.map(migrations, (migration, key) =>
        legacy.has(key)
          ? Effect.void
          : Effect.forEach(migrationStatements(migration), (statement) => sql.unsafe(statement), {
              discard: true,
            }),
      ),
    ),
  }).pipe(Effect.provideService(SqlClient, sql), Effect.catchTag("MigrationError", Effect.die));
  if (legacy.size > 0) yield* sql`drop table if exists ${sql(LEGACY_LEDGER_TABLE)}`;
});
