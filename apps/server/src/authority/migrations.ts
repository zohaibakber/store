import { authorityMigrations } from "@store/db/authority/migrations";
import * as Effect from "effect/Effect";
import * as EffectRecord from "effect/Record";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";

export const AUTHORITY_MIGRATIONS_TABLE = "__store_authority_migrations";

const statementsOf = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const runMigrator = Migrator.make({});

export const migrateAuthority = Effect.fn("Authority.migrate")(function* (sql: SqlClient) {
  yield* runMigrator({
    table: AUTHORITY_MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      EffectRecord.map(authorityMigrations, (migration) =>
        Effect.forEach(statementsOf(migration), (statement) => sql.unsafe(statement), {
          discard: true,
        }),
      ),
    ),
  }).pipe(Effect.provideService(SqlClient, sql), Effect.catchTag("MigrationError", Effect.die));
});
