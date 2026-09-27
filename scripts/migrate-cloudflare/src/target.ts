import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { InventoryImportId, type OrganizationId } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  ChunkContentMismatch,
  ImportRejected,
  PersistenceError,
  persistingAs,
  TranslationFailed,
} from "./errors.ts";
import { decodeChunkRows, rowsChecksum, tableRowsSchema } from "./mapping.ts";
import {
  type ApplyChunkOutcome,
  ApplyChunkOutcome as ApplyChunkOutcomeSchema,
  type BusinessTable,
  type ImportObjectState,
  ImportObjectState as ImportObjectStateSchema,
  type Sha256Hex,
  type SqliteBusinessRow,
} from "./model.ts";
import { migrateStaging } from "./sqlite.ts";

interface OrganizationInventoryImportApi {
  readonly prepareImport: (
    organizationId: OrganizationId,
    importId: InventoryImportId,
  ) => Effect.Effect<void, ImportRejected | PersistenceError>;
  readonly applyChunk: (
    organizationId: OrganizationId,
    importId: InventoryImportId,
    table: BusinessTable,
    chunkIndex: number,
    checksum: Sha256Hex,
    rowsJson: string,
  ) => Effect.Effect<
    ApplyChunkOutcome,
    ChunkContentMismatch | ImportRejected | PersistenceError | TranslationFailed
  >;
  readonly readTable: (
    organizationId: OrganizationId,
    table: BusinessTable,
  ) => Effect.Effect<ReadonlyArray<SqliteBusinessRow>, PersistenceError | TranslationFailed>;
  readonly markReady: (
    organizationId: OrganizationId,
    importId: InventoryImportId,
  ) => Effect.Effect<void, ImportRejected | PersistenceError>;
  readonly readImportState: (
    organizationId: OrganizationId,
  ) => Effect.Effect<ImportObjectState, PersistenceError>;
}

export class OrganizationInventoryImport extends Context.Service<
  OrganizationInventoryImport,
  OrganizationInventoryImportApi
>()("@store/migrate/OrganizationInventoryImport") {}

const persistenceFail = (operation: string, cause: unknown): PersistenceError =>
  new PersistenceError({
    operation,
    message: `Inventory import ${operation} failed.`,
    cause,
  });

const persisting = (operation: string) =>
  persistingAs((cause) => persistenceFail(operation, cause));

const StagedImport = Schema.Struct({
  importId: InventoryImportId,
  status: Schema.Literals(["importing", "ready"]),
});

const ChunkKey = Schema.Struct({
  organizationId: Schema.String,
  table: Schema.String,
  chunkIndex: Schema.Number,
});

const makeTarget = (sql: SqliteClient.SqliteClient): OrganizationInventoryImportApi => {
  const selectApplied = SqlSchema.findOneOption({
    Request: ChunkKey,
    Result: Schema.Struct({ checksum: Schema.String }),
    execute: (key) =>
      sql`select checksum from import_applied_chunks where organization_id = ${key.organizationId} and table_name = ${key.table} and chunk_index = ${key.chunkIndex}`,
  });
  const readState = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: StagedImport,
    execute: (organizationId) =>
      sql`select import_id as importId, status from import_state where organization_id = ${organizationId}`,
  });
  const requireImporting = (
    organizationId: OrganizationId,
    importId: InventoryImportId,
    operation: string,
  ) =>
    Effect.gen(function* () {
      const state = yield* readState(organizationId);
      if (Option.isNone(state)) {
        return yield* new ImportRejected({
          organizationId,
          message: `Inventory import target is empty during ${operation}.`,
        });
      }
      if (state.value.status !== "importing" || state.value.importId !== importId) {
        return yield* new ImportRejected({
          organizationId,
          message: `Inventory import target is not importing ${importId}.`,
        });
      }
    });
  const insertRows = (table: BusinessTable, rows: ReadonlyArray<SqliteBusinessRow>) =>
    Effect.forEach(rows, (row) => sql`insert into ${sql(table)} ${sql.insert({ ...row })}`, {
      discard: true,
    });

  return {
    prepareImport: Effect.fn("Migrate.Target.prepareImport")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
    ) {
      yield* Effect.gen(function* () {
        const state = yield* readState(organizationId);
        if (Option.isNone(state)) {
          yield* sql`insert into import_state (organization_id, import_id, status) values (${organizationId}, ${importId}, 'importing')`;
          return;
        }
        if (state.value.status === "ready") {
          if (state.value.importId === importId) return;
          return yield* new ImportRejected({
            organizationId,
            message: "Import attempts against an already validated target are rejected.",
          });
        }
        if (state.value.importId !== importId) {
          return yield* new ImportRejected({
            organizationId,
            message: "Inventory import target is already importing a different dataset.",
          });
        }
      }).pipe(sql.withTransaction);
    }, persisting("prepareImport")),
    applyChunk: Effect.fn("Migrate.Target.applyChunk")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
      table: BusinessTable,
      chunkIndex: number,
      checksum: Sha256Hex,
      rowsJson: string,
    ) {
      const rows = yield* decodeChunkRows(table, rowsJson);
      const mismatch = new ChunkContentMismatch({
        organizationId,
        table,
        chunkIndex,
        message: "Imported chunk identity collided with different bytes.",
      });
      if (rowsChecksum(rows) !== checksum) return yield* mismatch;
      if (!rows.every((row) => row.organizationId === organizationId)) {
        return yield* new ImportRejected({
          organizationId,
          message: `Chunk ${table} ${String(chunkIndex)} contains a foreign organization.`,
        });
      }
      return yield* Effect.gen(function* () {
        const existing = yield* selectApplied({ organizationId, table, chunkIndex });
        if (Option.isSome(existing)) {
          if (existing.value.checksum !== checksum) return yield* mismatch;
          return ApplyChunkOutcomeSchema.cases.duplicate.make({});
        }
        yield* requireImporting(organizationId, importId, "applyChunk");
        yield* insertRows(table, rows);
        yield* sql`insert into import_applied_chunks (organization_id, table_name, chunk_index, checksum) values (${organizationId}, ${table}, ${chunkIndex}, ${checksum})`;
        return ApplyChunkOutcomeSchema.cases.applied.make({});
      }).pipe(sql.withTransaction);
    }, persisting("applyChunk")),
    readTable: Effect.fn("Migrate.Target.readTable")(function* (
      organizationId: OrganizationId,
      table: BusinessTable,
    ) {
      const rows =
        yield* sql`select * from ${sql(table)} where organizationId = ${organizationId} order by rowid asc`;
      return yield* Schema.decodeUnknownEffect(tableRowsSchema(table))(rows).pipe(
        Effect.mapError(
          (cause) =>
            new TranslationFailed({
              table,
              message: `Stored ${table} row failed SQLite schema checks.`,
              cause,
            }),
        ),
      );
    }, persisting("readTable")),
    markReady: Effect.fn("Migrate.Target.markReady")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
    ) {
      yield* Effect.gen(function* () {
        const state = yield* readState(organizationId);
        if (
          Option.isSome(state) &&
          state.value.status === "ready" &&
          state.value.importId === importId
        ) {
          return;
        }
        yield* requireImporting(organizationId, importId, "markReady");
        yield* sql`update import_state set status = 'ready' where organization_id = ${organizationId}`;
      }).pipe(sql.withTransaction);
    }, persisting("markReady")),
    readImportState: Effect.fn("Migrate.Target.readImportState")(function* (
      organizationId: OrganizationId,
    ) {
      const state = yield* readState(organizationId);
      if (Option.isNone(state)) {
        return ImportObjectStateSchema.cases.empty.make({ organizationId });
      }
      const staged = { organizationId, importId: state.value.importId };
      return state.value.status === "importing"
        ? ImportObjectStateSchema.cases.importing.make(staged)
        : ImportObjectStateSchema.cases.ready.make(staged);
    }, persisting("readImportState")),
  };
};

export const sqliteTargetLayer = (
  sql: SqliteClient.SqliteClient,
): Layer.Layer<OrganizationInventoryImport> =>
  Layer.effect(
    OrganizationInventoryImport,
    migrateStaging(sql).pipe(
      Effect.orDie,
      Effect.as(OrganizationInventoryImport.of(makeTarget(sql))),
    ),
  );
