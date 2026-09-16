import { inventoryMigrations } from "@store/db/inventory/migrations";
import Database from "better-sqlite3";
import * as Schema from "effect/Schema";

const STATEMENT_SEPARATOR = "--> statement-breakpoint";
const LEDGER_TABLE = "__store_migrate_migrations";
const MIGRATION_KEY_PATTERN = /^[0-9a-z_]+$/u;

type SqliteMigrationTarget = {
  readonly execute: (sql: string, parameters: ReadonlyArray<string>) => void;
  readonly appliedKeys: (sql: string) => ReadonlyArray<string>;
};

const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const runMigrations = (migrations: Record<string, string>, target: SqliteMigrationTarget): void => {
  target.execute(`create table if not exists ${LEDGER_TABLE} (key text primary key not null)`, []);
  const applied = new Set(target.appliedKeys(`select key from ${LEDGER_TABLE}`));
  for (const key of Object.keys(migrations).sort()) {
    if (applied.has(key)) continue;
    if (!MIGRATION_KEY_PATTERN.test(key)) {
      throw new Error(`Migration key ${key} is not a safe identifier.`);
    }
    const migration = migrations[key];
    if (migration === undefined) continue;
    for (const statement of migrationStatements(migration)) target.execute(statement, []);
    target.execute(`insert into ${LEDGER_TABLE} (key) values (?)`, [key]);
  }
};

const decodeKeys = Schema.decodeUnknownSync(Schema.Array(Schema.String));

const betterSqliteTarget = (sqlite: Database.Database): SqliteMigrationTarget => ({
  execute: (sql, parameters) => {
    sqlite.prepare(sql).run(...parameters);
  },
  appliedKeys: (sql) => decodeKeys(sqlite.prepare(sql).pluck().all()),
});

export const openSqlite = (path: string): Database.Database => {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  return sqlite;
};

export const migrateInventoryAuthority = (sqlite: Database.Database): void => {
  runMigrations(inventoryMigrations, betterSqliteTarget(sqlite));
  sqlite.exec(`
    create table if not exists import_applied_chunks (
      organization_id text not null,
      table_name text not null,
      chunk_index integer not null,
      checksum text not null,
      primary key (organization_id, table_name, chunk_index)
    )
  `);
};

export const migrateDirectory = (sqlite: Database.Database): void => {
  sqlite.exec(`
    create table if not exists auth_organization (
      id text primary key,
      name text not null,
      slug text,
      createdAt integer not null,
      updatedAt integer not null
    );
    create table if not exists inventory_dataset_release (
      id text primary key,
      status text not null,
      createdAt integer not null,
      publishedAt integer
    );
    create table if not exists inventory_release_entry (
      releaseId text not null,
      organizationId text not null,
      objectName text not null,
      importId text not null,
      status text not null,
      primary key (releaseId, organizationId),
      foreign key (releaseId) references inventory_dataset_release(id),
      foreign key (organizationId) references auth_organization(id)
    );
    create table if not exists inventory_active_release (
      id integer primary key,
      releaseId text not null,
      activatedAt integer not null,
      foreign key (releaseId) references inventory_dataset_release(id)
    )
  `);
};

export const runSqliteTransaction = <A>(sqlite: Database.Database, run: () => A): A =>
  sqlite.transaction(run)();

export const migrateJournal = (sqlite: Database.Database): void => {
  sqlite.exec(`
    create table if not exists migration_record (
      singleton integer primary key check (singleton = 1),
      record_json text not null
    );
    create table if not exists export_chunk (
      organization_id text not null,
      table_name text not null,
      chunk_index integer not null,
      checksum text not null,
      rows_json text not null,
      primary key (organization_id, table_name, chunk_index)
    );
    create table if not exists export_manifest (
      singleton integer primary key check (singleton = 1),
      manifest_json text not null
    )
  `);
};
