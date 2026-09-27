import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import type { SqlError } from "effect/unstable/sql/SqlError";

export const openSqlite = (
  filename: string,
): Effect.Effect<SqliteClient.SqliteClient, never, Scope.Scope> =>
  SqliteClient.make({ filename }).pipe(Effect.provide(Reactivity.layer));

const executeAll = (sql: SqliteClient.SqliteClient, statements: ReadonlyArray<string>) =>
  Effect.forEach(statements, (statement) => sql.unsafe(statement), { discard: true });

const MUTABLE_COLUMNS = `createdAt integer not null,
      updatedAt integer not null,
      deletedAt integer,
      organizationId text not null,
      createdByUserId text not null,
      updatedByUserId text not null,
      deviceId text not null,
      operationId text not null,
      rowVersion integer not null`;

export const migrateStaging = (sql: SqliteClient.SqliteClient): Effect.Effect<void, SqlError> =>
  executeAll(sql, [
    `create table if not exists categories (
      id text not null,
      name text not null,
      tracksPacks integer not null,
      ${MUTABLE_COLUMNS},
      primary key (organizationId, id)
    )`,
    `create table if not exists products (
      id text not null,
      name text not null,
      categoryId text not null,
      aisle text,
      composition text,
      strength text,
      unitsPerPack integer not null,
      purchasePrice integer,
      retailPrice integer,
      unitPrice integer,
      visible integer not null,
      ${MUTABLE_COLUMNS},
      primary key (organizationId, id)
    )`,
    `create table if not exists batches (
      id text not null,
      productId text not null,
      batchNumber text,
      expiresAt integer,
      packQuantity integer not null,
      unitQuantity integer not null,
      ${MUTABLE_COLUMNS},
      primary key (organizationId, id)
    )`,
    `create table if not exists invoices (
      id text not null,
      invoiceNumber integer not null,
      customerName text,
      total integer not null,
      ${MUTABLE_COLUMNS},
      primary key (organizationId, id)
    )`,
    `create table if not exists invoice_items (
      id text not null,
      invoiceId text not null,
      productId text not null,
      batchId text not null,
      productName text not null,
      batchNumber text,
      quantity integer not null,
      quantityType text not null,
      baseUnitQuantity integer not null,
      salePrice integer not null,
      ${MUTABLE_COLUMNS},
      primary key (organizationId, id)
    )`,
    `create table if not exists stock_movements (
      id text not null,
      productId text not null,
      batchId text not null,
      invoiceId text,
      type text not null,
      packDelta integer not null,
      unitDelta integer not null,
      note text,
      organizationId text not null,
      actorUserId text not null,
      deviceId text not null,
      operationId text not null,
      createdAt integer not null,
      primary key (organizationId, id)
    )`,
    `create table if not exists import_state (
      organization_id text primary key not null,
      import_id text not null,
      status text not null check (status in ('importing', 'ready'))
    )`,
    `create table if not exists import_applied_chunks (
      organization_id text not null,
      table_name text not null,
      chunk_index integer not null,
      checksum text not null,
      primary key (organization_id, table_name, chunk_index)
    )`,
  ]);

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
