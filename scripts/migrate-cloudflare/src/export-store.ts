import type { OrganizationId } from "@store/contracts";
import type Database from "better-sqlite3";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
  type BusinessTable,
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
import { migrateJournal, runSqliteTransaction } from "./sqlite.ts";

const StoredRecord = Schema.fromJsonString(MigrationRecordSchema);
const StoredManifest = Schema.fromJsonString(ExportManifestSchema);
const decodeRecordJson = Schema.decodeUnknownEffect(StoredRecord);
const decodeManifestJson = Schema.decodeUnknownEffect(StoredManifest);
const encodeRecordJson = Schema.encodeUnknownSync(StoredRecord);
const encodeManifestJson = Schema.encodeUnknownSync(StoredManifest);

const JsonTextRow = Schema.Struct({ record_json: Schema.String });
const ManifestTextRow = Schema.Struct({ manifest_json: Schema.String });
const ChecksumRow = Schema.Struct({ checksum: Schema.String });
const StoredChunkRow = Schema.Struct({
  organization_id: Schema.String,
  table_name: Schema.String,
  chunk_index: Schema.Number,
  checksum: Schema.String,
  rows_json: Schema.String,
});
const StoredChunkRows = Schema.Array(StoredChunkRow);
const decodeJsonTextRow = Schema.decodeUnknownOption(JsonTextRow);
const decodeManifestTextRow = Schema.decodeUnknownOption(ManifestTextRow);
const decodeChecksumRow = Schema.decodeUnknownOption(ChecksumRow);
const decodeStoredChunkRows = Schema.decodeUnknownOption(StoredChunkRows);

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

const malformed = (operation: string): PersistenceError =>
  persistenceFail(operation, new Error(`Journal ${operation} row failed schema checks.`));

const decodeChunkRow = (
  row: typeof StoredChunkRow.Type,
): Effect.Effect<ExportChunk, PersistenceError> =>
  Schema.decodeUnknownEffect(ExportChunkSchema)({
    organizationId: row.organization_id,
    table: row.table_name,
    chunkIndex: row.chunk_index,
    checksum: row.checksum,
    rowsJson: row.rows_json,
  }).pipe(Effect.mapError((cause) => persistenceFail("loadChunks", cause)));

const requireChunkRows = (
  decoded: Option.Option<ReadonlyArray<typeof StoredChunkRow.Type>>,
  operation: string,
): Effect.Effect<ReadonlyArray<typeof StoredChunkRow.Type>, PersistenceError> => {
  if (Option.isNone(decoded)) return Effect.fail(malformed(operation));
  return Effect.succeed(decoded.value);
};

const makeExportStore = (sqlite: Database.Database): ExportStoreApi => {
  const selectRecord = sqlite.prepare(
    "select record_json from migration_record where singleton = 1",
  );
  const upsertRecord = sqlite.prepare(
    "insert into migration_record (singleton, record_json) values (1, ?) on conflict(singleton) do update set record_json = excluded.record_json",
  );
  const selectChunk = sqlite.prepare(
    "select checksum from export_chunk where organization_id = ? and table_name = ? and chunk_index = ?",
  );
  const insertChunk = sqlite.prepare(
    "insert into export_chunk (organization_id, table_name, chunk_index, checksum, rows_json) values (?, ?, ?, ?, ?)",
  );
  const selectTableChunks = sqlite.prepare(
    "select organization_id, table_name, chunk_index, checksum, rows_json from export_chunk where organization_id = ? and table_name = ? order by chunk_index asc",
  );
  const selectAllChunks = sqlite.prepare(
    "select organization_id, table_name, chunk_index, checksum, rows_json from export_chunk order by organization_id asc, table_name asc, chunk_index asc",
  );
  const selectManifest = sqlite.prepare(
    "select manifest_json from export_manifest where singleton = 1",
  );
  const insertManifest = sqlite.prepare(
    "insert into export_manifest (singleton, manifest_json) values (1, ?)",
  );

  return {
    loadRecord: Effect.fn("Migrate.ExportStore.loadRecord")(function* () {
      const row = yield* Effect.try({
        try: () => selectRecord.get(),
        catch: (cause) => persistenceFail("loadRecord", cause),
      });
      if (row === undefined) return Option.none();
      const parsed = decodeJsonTextRow(row);
      if (Option.isNone(parsed)) return yield* Effect.fail(malformed("loadRecord"));
      const record = yield* decodeRecordJson(parsed.value.record_json).pipe(
        Effect.mapError((cause) => persistenceFail("loadRecord", cause)),
      );
      return Option.some(record);
    }),
    saveRecord: Effect.fn("Migrate.ExportStore.saveRecord")(function* (record: MigrationRecord) {
      const json = encodeRecordJson(record);
      yield* Effect.try({
        try: () => {
          upsertRecord.run(json);
        },
        catch: (cause) => persistenceFail("saveRecord", cause),
      });
    }),
    saveChunk: Effect.fn("Migrate.ExportStore.saveChunk")(function* (chunk: ExportChunk) {
      yield* Effect.try({
        try: () =>
          runSqliteTransaction(sqlite, () => {
            const raw = selectChunk.get(chunk.organizationId, chunk.table, chunk.chunkIndex);
            if (raw !== undefined) {
              const existing = decodeChecksumRow(raw);
              if (Option.isNone(existing)) {
                throw malformed("saveChunk");
              }
              if (existing.value.checksum !== chunk.checksum) {
                throw new ChunkContentMismatch({
                  organizationId: chunk.organizationId,
                  table: chunk.table,
                  chunkIndex: chunk.chunkIndex,
                  message: "Export chunk identity collided with different bytes.",
                });
              }
              return;
            }
            insertChunk.run(
              chunk.organizationId,
              chunk.table,
              chunk.chunkIndex,
              chunk.checksum,
              chunk.rowsJson,
            );
          }),
        catch: (cause) => {
          if (cause instanceof ChunkContentMismatch || cause instanceof PersistenceError)
            return cause;
          return persistenceFail("saveChunk", cause);
        },
      });
    }),
    loadChunks: Effect.fn("Migrate.ExportStore.loadChunks")(function* (
      organizationId: OrganizationId,
      table: BusinessTable,
    ) {
      const raw = yield* Effect.try({
        try: () => selectTableChunks.all(organizationId, table),
        catch: (cause) => persistenceFail("loadChunks", cause),
      });
      const rows = yield* requireChunkRows(decodeStoredChunkRows(raw), "loadChunks");
      return yield* Effect.forEach(rows, decodeChunkRow);
    }),
    loadAllChunks: Effect.fn("Migrate.ExportStore.loadAllChunks")(function* () {
      const raw = yield* Effect.try({
        try: () => selectAllChunks.all(),
        catch: (cause) => persistenceFail("loadAllChunks", cause),
      });
      const rows = yield* requireChunkRows(decodeStoredChunkRows(raw), "loadAllChunks");
      return yield* Effect.forEach(rows, decodeChunkRow);
    }),
    saveManifest: Effect.fn("Migrate.ExportStore.saveManifest")(function* (
      manifest: ExportManifest,
    ) {
      const unsigned = {
        schemaVersion: manifest.schemaVersion,
        mappingVersion: manifest.mappingVersion,
        organizations: manifest.organizations,
      };
      if (checksumValue(unsigned) !== manifest.checksum) {
        return yield* Effect.fail(
          new ManifestIncomplete({
            message: "Export manifest checksum does not match its contents.",
          }),
        );
      }
      const json = encodeManifestJson(manifest);
      yield* Effect.try({
        try: () => {
          const raw = selectManifest.get();
          if (raw !== undefined) {
            const existing = decodeManifestTextRow(raw);
            if (Option.isNone(existing)) {
              throw malformed("saveManifest");
            }
            if (existing.value.manifest_json !== json) {
              throw new ManifestIncomplete({
                message: "A different complete export manifest is already stored.",
              });
            }
            return;
          }
          insertManifest.run(json);
        },
        catch: (cause) => {
          if (cause instanceof ManifestIncomplete || cause instanceof PersistenceError)
            return cause;
          return persistenceFail("saveManifest", cause);
        },
      });
    }),
    loadManifest: Effect.fn("Migrate.ExportStore.loadManifest")(function* () {
      const row = yield* Effect.try({
        try: () => selectManifest.get(),
        catch: (cause) => persistenceFail("loadManifest", cause),
      });
      if (row === undefined) return Option.none();
      const parsed = decodeManifestTextRow(row);
      if (Option.isNone(parsed)) return yield* Effect.fail(malformed("loadManifest"));
      const manifest = yield* decodeManifestJson(parsed.value.manifest_json).pipe(
        Effect.mapError((cause) => persistenceFail("loadManifest", cause)),
      );
      return Option.some(manifest);
    }),
    buildManifest: Effect.fn("Migrate.ExportStore.buildManifest")(function* (
      organizations: ReadonlyArray<OrganizationSelection>,
    ) {
      if (organizations.length === 0) {
        return yield* Effect.fail(
          new ManifestIncomplete({
            message: "Export manifest requires at least one organization.",
          }),
        );
      }
      const orgManifests: Array<OrganizationManifest> = [];
      for (const selection of organizations) {
        const tables: Array<TableChecksum> = [];
        let aggregates = emptyAggregates();
        for (const table of BUSINESS_TABLES) {
          const raw = yield* Effect.try({
            try: () => selectTableChunks.all(selection.organizationId, table),
            catch: (cause) => persistenceFail("buildManifest", cause),
          });
          const stored = yield* requireChunkRows(decodeStoredChunkRows(raw), "buildManifest");
          const decodedChunks = yield* Effect.forEach(stored, decodeChunkRow);
          const rows = (yield* Effect.forEach(decodedChunks, (chunk) =>
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
      const first = orgManifests[0];
      if (first === undefined) {
        return yield* Effect.fail(
          new ManifestIncomplete({
            message: "Export manifest requires at least one organization.",
          }),
        );
      }
      return ExportManifestSchema.make({
        schemaVersion: POSTGRES_SCHEMA_VERSION,
        mappingVersion: SQLITE_MAPPING_VERSION,
        organizations: [first, ...orgManifests.slice(1)],
        checksum: checksumValue({
          schemaVersion: POSTGRES_SCHEMA_VERSION,
          mappingVersion: SQLITE_MAPPING_VERSION,
          organizations: [first, ...orgManifests.slice(1)],
        }),
      });
    }),
  };
};

export const journalLayerFromSqlite = (sqlite: Database.Database): Layer.Layer<ExportStore> =>
  Layer.sync(ExportStore, () => {
    migrateJournal(sqlite);
    return ExportStore.of(makeExportStore(sqlite));
  });
