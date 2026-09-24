import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { OrganizationId } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  ChunkContentMismatch,
  ManifestIncomplete,
  PersistenceError,
  type TranslationFailed,
} from "./errors.ts";
import { checksumValue } from "./hash.ts";
import { addAggregate, decodeChunkRows, emptyAggregates, rowsChecksum } from "./mapping.ts";
import {
  BUSINESS_TABLES,
  BusinessTable,
  type ExportChunk,
  ExportChunk as ExportChunkSchema,
  type ExportManifest,
  ExportManifest as ExportManifestSchema,
  type MigrationRecord,
  MigrationRecord as MigrationRecordSchema,
  type OrganizationManifest,
  type OrganizationSelection,
  POSTGRES_SCHEMA_VERSION,
  SQLITE_MAPPING_VERSION,
  type TableChecksum,
} from "./model.ts";
import { migrateJournal, persistingAs } from "./sqlite.ts";

const StoredRecord = Schema.fromJsonString(MigrationRecordSchema);
const StoredManifest = Schema.fromJsonString(ExportManifestSchema);
const encodeRecordJson = Schema.encodeUnknownSync(StoredRecord);
const encodeManifestJson = Schema.encodeUnknownSync(StoredManifest);

const ChunkKey = Schema.Struct({
  organizationId: Schema.String,
  table: BusinessTable,
  chunkIndex: Schema.Number,
});
const TableKey = Schema.Struct({ organizationId: Schema.String, table: BusinessTable });

export interface ExportStoreApi {
  readonly loadRecord: () => Effect.Effect<Option.Option<MigrationRecord>, PersistenceError>;
  readonly saveRecord: (record: MigrationRecord) => Effect.Effect<void, PersistenceError>;
  readonly saveChunk: (
    chunk: ExportChunk,
  ) => Effect.Effect<void, ChunkContentMismatch | PersistenceError>;
  readonly loadChunks: (
    organizationId: OrganizationId,
    table: BusinessTable,
  ) => Effect.Effect<ReadonlyArray<ExportChunk>, PersistenceError>;
  readonly loadAllChunks: () => Effect.Effect<ReadonlyArray<ExportChunk>, PersistenceError>;
  readonly saveManifest: (
    manifest: ExportManifest,
  ) => Effect.Effect<void, ManifestIncomplete | PersistenceError>;
  readonly loadManifest: () => Effect.Effect<Option.Option<ExportManifest>, PersistenceError>;
  readonly buildManifest: (
    organizations: ReadonlyArray<OrganizationSelection>,
  ) => Effect.Effect<ExportManifest, ManifestIncomplete | PersistenceError | TranslationFailed>;
}

export class ExportStore extends Context.Service<ExportStore, ExportStoreApi>()(
  "@store/migrate/ExportStore",
) {}

const persistenceFail = (operation: string, cause: unknown): PersistenceError =>
  new PersistenceError({
    operation,
    message: `Migration journal ${operation} failed.`,
    cause,
  });

const persisting = (operation: string) =>
  persistingAs((cause) => persistenceFail(operation, cause));

const makeExportStore = (sql: SqliteClient.SqliteClient): ExportStoreApi => {
  const selectRecord = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Schema.Struct({ record: StoredRecord }),
    execute: () => sql`select record_json as record from migration_record where singleton = 1`,
  });
  const selectChunkChecksum = SqlSchema.findOneOption({
    Request: ChunkKey,
    Result: Schema.Struct({ checksum: Schema.String }),
    execute: (key) =>
      sql`select checksum from export_chunk where organization_id = ${key.organizationId} and table_name = ${key.table} and chunk_index = ${key.chunkIndex}`,
  });
  const selectTableChunks = SqlSchema.findAll({
    Request: TableKey,
    Result: ExportChunkSchema,
    execute: (key) =>
      sql`select organization_id as organizationId, table_name as "table", chunk_index as chunkIndex, checksum, rows_json as rowsJson from export_chunk where organization_id = ${key.organizationId} and table_name = ${key.table} order by chunk_index asc`,
  });
  const selectAllChunks = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ExportChunkSchema,
    execute: () =>
      sql`select organization_id as organizationId, table_name as "table", chunk_index as chunkIndex, checksum, rows_json as rowsJson from export_chunk order by organization_id asc, table_name asc, chunk_index asc`,
  });
  const selectManifestJson = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Schema.Struct({ manifestJson: Schema.String }),
    execute: () =>
      sql`select manifest_json as manifestJson from export_manifest where singleton = 1`,
  });
  const selectManifest = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Schema.Struct({ manifest: StoredManifest }),
    execute: () => sql`select manifest_json as manifest from export_manifest where singleton = 1`,
  });

  const loadChunks = (organizationId: OrganizationId, table: BusinessTable) =>
    selectTableChunks({ organizationId, table });

  return {
    loadRecord: Effect.fn("Migrate.ExportStore.loadRecord")(function* () {
      const row = yield* selectRecord(undefined);
      return Option.map(row, (stored) => stored.record);
    }, persisting("loadRecord")),
    saveRecord: Effect.fn("Migrate.ExportStore.saveRecord")(function* (record: MigrationRecord) {
      const json = encodeRecordJson(record);
      yield* sql`insert into migration_record (singleton, record_json) values (1, ${json}) on conflict(singleton) do update set record_json = excluded.record_json`;
    }, persisting("saveRecord")),
    saveChunk: Effect.fn("Migrate.ExportStore.saveChunk")(function* (chunk: ExportChunk) {
      yield* Effect.gen(function* () {
        const existing = yield* selectChunkChecksum(chunk);
        if (Option.isSome(existing)) {
          if (existing.value.checksum === chunk.checksum) return;
          return yield* new ChunkContentMismatch({
            organizationId: chunk.organizationId,
            table: chunk.table,
            chunkIndex: chunk.chunkIndex,
            message: "Export chunk identity collided with different bytes.",
          });
        }
        yield* sql`insert into export_chunk (organization_id, table_name, chunk_index, checksum, rows_json) values (${chunk.organizationId}, ${chunk.table}, ${chunk.chunkIndex}, ${chunk.checksum}, ${chunk.rowsJson})`;
      }).pipe(sql.withTransaction);
    }, persisting("saveChunk")),
    loadChunks: Effect.fn("Migrate.ExportStore.loadChunks")(function* (
      organizationId: OrganizationId,
      table: BusinessTable,
    ) {
      return yield* loadChunks(organizationId, table);
    }, persisting("loadChunks")),
    loadAllChunks: Effect.fn("Migrate.ExportStore.loadAllChunks")(function* () {
      return yield* selectAllChunks(undefined);
    }, persisting("loadAllChunks")),
    saveManifest: Effect.fn("Migrate.ExportStore.saveManifest")(function* (
      manifest: ExportManifest,
    ) {
      const unsigned = {
        schemaVersion: manifest.schemaVersion,
        mappingVersion: manifest.mappingVersion,
        organizations: manifest.organizations,
      };
      if (checksumValue(unsigned) !== manifest.checksum) {
        return yield* new ManifestIncomplete({
          message: "Export manifest checksum does not match its contents.",
        });
      }
      const json = encodeManifestJson(manifest);
      const existing = yield* selectManifestJson(undefined);
      if (Option.isSome(existing)) {
        if (existing.value.manifestJson === json) return;
        return yield* new ManifestIncomplete({
          message: "A different complete export manifest is already stored.",
        });
      }
      yield* sql`insert into export_manifest (singleton, manifest_json) values (1, ${json})`;
    }, persisting("saveManifest")),
    loadManifest: Effect.fn("Migrate.ExportStore.loadManifest")(function* () {
      const row = yield* selectManifest(undefined);
      return Option.map(row, (stored) => stored.manifest);
    }, persisting("loadManifest")),
    buildManifest: Effect.fn("Migrate.ExportStore.buildManifest")(function* (
      organizations: ReadonlyArray<OrganizationSelection>,
    ) {
      const orgManifests: Array<OrganizationManifest> = [];
      for (const selection of organizations) {
        const tables: Array<TableChecksum> = [];
        let aggregates = emptyAggregates();
        for (const table of BUSINESS_TABLES) {
          const chunks = yield* loadChunks(selection.organizationId, table);
          const rows = (yield* Effect.forEach(chunks, (chunk) =>
            decodeChunkRows(table, chunk.rowsJson),
          )).flat();
          tables.push({
            table,
            rowCount: rows.length,
            checksum: rowsChecksum(rows),
          });
          aggregates = addAggregate(aggregates, table, rows);
        }
        orgManifests.push({
          organizationId: selection.organizationId,
          objectName: selection.objectName,
          tables,
          aggregates,
        });
      }
      const [first, ...rest] = orgManifests;
      if (first === undefined) {
        return yield* new ManifestIncomplete({
          message: "Export manifest requires at least one organization.",
        });
      }
      const manifest = {
        schemaVersion: POSTGRES_SCHEMA_VERSION,
        mappingVersion: SQLITE_MAPPING_VERSION,
        organizations: [first, ...rest],
      } as const;
      return ExportManifestSchema.make({ ...manifest, checksum: checksumValue(manifest) });
    }, persisting("buildManifest")),
  };
};

export const journalLayerFromSqlite = (sql: SqliteClient.SqliteClient): Layer.Layer<ExportStore> =>
  Layer.effect(
    ExportStore,
    migrateJournal(sql).pipe(Effect.orDie, Effect.as(ExportStore.of(makeExportStore(sql)))),
  );
