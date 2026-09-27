import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError";

import { inventoryAuthorityMigrations } from "./authority-migrations.gen.ts";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";
const LEDGER_TABLE = "__store_migrate_migrations";
const MIGRATION_KEY_PATTERN = /^[0-9a-z_]+$/u;

const decodeLedgerRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ key: Schema.String })),
);

export const openSqlite = (
  filename: string,
): Effect.Effect<SqliteClient.SqliteClient, never, Scope.Scope> =>
  SqliteClient.make({ filename }).pipe(Effect.provide(Reactivity.layer));

type StorageFailure =
  | SqlError
  | Schema.SchemaError
  | { readonly _tag: "EffectDrizzleQueryError" }
  | { readonly _tag: "EffectDrizzleError" };

const isStorageFailure = (cause: unknown): boolean =>
  isSqlError(cause) ||
  Schema.isSchemaError(cause) ||
  Predicate.isTagged(cause, "EffectDrizzleQueryError") ||
  Predicate.isTagged(cause, "EffectDrizzleError");

export const persistingAs =
  <Failure>(fail: (cause: StorageFailure) => Failure) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Exclude<E, Extract<E, StorageFailure>> | Failure, R> =>
    effect.pipe(
      Effect.catchIf(
        (cause): cause is Extract<E, StorageFailure> => isStorageFailure(cause),
        (cause) => Effect.fail(fail(cause)),
        Effect.fail,
      ),
    );

const executeAll = (sql: SqliteClient.SqliteClient, statements: ReadonlyArray<string>) =>
  Effect.forEach(statements, (statement) => sql.unsafe(statement), { discard: true });

const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const runMigrations = (sql: SqliteClient.SqliteClient, migrations: Record<string, string>) =>
  Effect.gen(function* () {
    yield* sql.unsafe(`create table if not exists ${LEDGER_TABLE} (key text primary key not null)`);
    const ledger = yield* sql
      .unsafe(`select key from ${LEDGER_TABLE}`)
      .pipe(Effect.flatMap(decodeLedgerRows), Effect.orDie);
    const applied = new Set(ledger.map((row) => row.key));
    for (const key of Object.keys(migrations).sort()) {
      if (applied.has(key)) continue;
      if (!MIGRATION_KEY_PATTERN.test(key)) {
        return yield* Effect.die(new Error(`Migration key ${key} is not a safe identifier.`));
      }
      const migration = migrations[key];
      if (migration === undefined) continue;
      yield* executeAll(sql, migrationStatements(migration));
      yield* sql.unsafe(`insert into ${LEDGER_TABLE} (key) values (?)`, [key]);
    }
  });

export const migrateInventoryAuthority = (
  sql: SqliteClient.SqliteClient,
): Effect.Effect<void, SqlError> =>
  runMigrations(sql, inventoryAuthorityMigrations).pipe(
    Effect.andThen(
      sql.unsafe(`create table if not exists import_applied_chunks (
        organization_id text not null,
        table_name text not null,
        chunk_index integer not null,
        checksum text not null,
        primary key (organization_id, table_name, chunk_index)
      )`),
    ),
    Effect.asVoid,
  );

export const migrateDirectory = (sql: SqliteClient.SqliteClient): Effect.Effect<void, SqlError> =>
  executeAll(sql, [
    `create table if not exists auth_organization (
      id text primary key,
      name text not null,
      slug text,
      createdAt integer not null,
      updatedAt integer not null
    )`,
    `create table if not exists inventory_dataset_release (
      id text primary key,
      status text not null,
      createdAt integer not null,
      publishedAt integer
    )`,
    `create table if not exists inventory_release_entry (
      releaseId text not null,
      organizationId text not null,
      objectName text not null,
      importId text not null,
      status text not null,
      primary key (releaseId, organizationId),
      foreign key (releaseId) references inventory_dataset_release(id),
      foreign key (organizationId) references auth_organization(id)
    )`,
    `create table if not exists inventory_active_release (
      id integer primary key,
      releaseId text not null,
      activatedAt integer not null,
      foreign key (releaseId) references inventory_dataset_release(id)
    )`,
  ]);

export const migrateJournal = (sql: SqliteClient.SqliteClient): Effect.Effect<void, SqlError> =>
  executeAll(sql, [
    `create table if not exists migration_record (
      singleton integer primary key check (singleton = 1),
      record_json text not null
    )`,
    `create table if not exists export_chunk (
      organization_id text not null,
      table_name text not null,
      chunk_index integer not null,
      checksum text not null,
      rows_json text not null,
      primary key (organization_id, table_name, chunk_index)
    )`,
    `create table if not exists export_manifest (
      singleton integer primary key check (singleton = 1),
      manifest_json text not null
    )`,
  ]);
