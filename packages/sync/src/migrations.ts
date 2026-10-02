import * as Effect from "effect/Effect";
import * as EffectRecord from "effect/Record";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";

export const MIGRATIONS_TABLE = "__store_replica_migrations";

export const LEGACY_LEDGER_TABLE = "__store_sync_migrations";

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

const MIGRATION_KEY = /^(\d+)_/u;

const migrationId = (key: string): number => Number(MIGRATION_KEY.exec(key)?.[1] ?? Number.NaN);

type MigrationLedgerVerdict = "openable" | "newer" | "unknown";

export const judgeMigrationLedger = (
  applied: ReadonlyArray<string>,
  migrations: Record<string, string>,
): MigrationLedgerVerdict => {
  const strangers = applied.filter((key) => !Object.hasOwn(migrations, key));
  if (strangers.length === 0) return "openable";
  const latest = Math.max(0, ...Object.keys(migrations).map(migrationId));
  return strangers.some((key) => migrationId(key) > latest) ? "newer" : "unknown";
};

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
