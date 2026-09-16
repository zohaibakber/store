import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MigrationCheckpoint } from "./checkpoint.ts";
import { DatasetReleaseDirectory, type ReleaseEntry } from "./directory.ts";
import {
  ConfigurationError,
  ManifestIncomplete,
  type MigrationError,
  PublicationFailed,
} from "./errors.ts";
import { ExportStore } from "./export-store.ts";
import { MigrationIds } from "./ids.ts";
import { decodeChunkRows, encodeRowsJson, rowsChecksum, translateDriverRows } from "./mapping.ts";
import {
  BUSINESS_TABLES,
  type BusinessTable,
  type CompletedMigration,
  CompletedMigration as CompletedMigrationSchema,
  type ExportChunk,
  ExportChunk as ExportChunkSchema,
  type MigrationPhase,
  MigrationPhase as MigrationPhaseSchema,
  type MigrationRecord,
  MigrationRecord as MigrationRecordSchema,
  type MigrationRequest,
  type OrganizationSelection,
  POSTGRES_SCHEMA_VERSION,
  SQLITE_MAPPING_VERSION,
  type Sha256Hex,
  SourceIdentity,
} from "./model.ts";
import { SourceCatalog } from "./source.ts";
import { OrganizationInventoryImport } from "./target.ts";
import { validateOrganization } from "./validation.ts";

const decodeSourceIdentity = Schema.decodeUnknownEffect(SourceIdentity);

const completedFrom = (
  record: MigrationRecord,
  phase: Extract<MigrationPhase, { _tag: "Completed" }>,
): CompletedMigration =>
  CompletedMigrationSchema.make({
    migrationId: record.migrationId,
    importId: record.importId,
    releaseId: phase.releaseId,
    publishedAt: phase.publishedAt,
    organizationCount: record.organizations.length,
    manifestChecksum: phase.manifestChecksum,
  });

const savePhase = (
  store: ExportStore["Service"],
  record: MigrationRecord,
  phase: MigrationPhase,
): Effect.Effect<MigrationRecord, MigrationError> => {
  const next = MigrationRecordSchema.make({
    migrationId: record.migrationId,
    sourceIdentity: record.sourceIdentity,
    schemaVersion: record.schemaVersion,
    mappingVersion: record.mappingVersion,
    organizations: record.organizations,
    importId: record.importId,
    phase,
  });
  return store.saveRecord(next).pipe(Effect.map(() => next));
};

const lastRowId = (chunk: ExportChunk): Effect.Effect<string, MigrationError> =>
  Effect.gen(function* () {
    const rows = yield* decodeChunkRows(chunk.table, chunk.rowsJson);
    const last = rows[rows.length - 1];
    return last === undefined ? "" : last.id;
  });

const organizationsMatch = (
  left: ReadonlyArray<OrganizationSelection>,
  right: ReadonlyArray<OrganizationSelection>,
): boolean =>
  left.length === right.length &&
  left.every(
    (org, index) =>
      right[index] !== undefined &&
      org.organizationId === right[index].organizationId &&
      org.objectName === right[index].objectName,
  );

const alreadyImported = (
  organizations: ReadonlyArray<OrganizationSelection>,
  phase: MigrationPhase,
  organizationId: OrganizationSelection["organizationId"],
  table: BusinessTable,
  chunkIndex: number,
): boolean => {
  if (phase._tag !== "Importing" || phase.lastCompletedChunk === null) return false;
  const last = phase.lastCompletedChunk;
  const lastOrg = organizations.findIndex((org) => org.organizationId === last.organizationId);
  const thisOrg = organizations.findIndex((org) => org.organizationId === organizationId);
  if (thisOrg < lastOrg) return true;
  if (thisOrg > lastOrg) return false;
  const lastTable = BUSINESS_TABLES.indexOf(last.table);
  const thisTable = BUSINESS_TABLES.indexOf(table);
  if (thisTable < lastTable) return true;
  if (thisTable > lastTable) return false;
  return last.chunkIndex >= chunkIndex;
};

const manifestChecksumOf = (
  phase: MigrationPhase,
): Effect.Effect<Sha256Hex, ManifestIncomplete> => {
  switch (phase._tag) {
    case "ManifestReady":
    case "Importing":
    case "Validated":
    case "Completed":
      return Effect.succeed(phase.manifestChecksum);
    default:
      return Effect.fail(
        new ManifestIncomplete({ message: "Import requires a finalized export manifest." }),
      );
  }
};

const exportRemaining = Effect.fn("Migrate.exportRemaining")(function* (
  record: MigrationRecord,
  chunkSize: number,
) {
  const source = yield* SourceCatalog;
  const store = yield* ExportStore;
  const checkpoint = yield* MigrationCheckpoint;
  let current = record;
  for (const selection of record.organizations) {
    for (const table of BUSINESS_TABLES) {
      const existing = yield* store.loadChunks(selection.organizationId, table);
      const lastChunk = existing[existing.length - 1];
      let afterId = lastChunk === undefined ? "" : yield* lastRowId(lastChunk);
      let chunkIndex = existing.length;
      while (true) {
        const page = yield* source.readPage(selection.organizationId, table, afterId, chunkSize);
        if (page.length === 0) break;
        const rows = yield* translateDriverRows(table, page);
        const chunk = ExportChunkSchema.make({
          organizationId: selection.organizationId,
          table,
          chunkIndex,
          checksum: rowsChecksum(rows),
          rowsJson: encodeRowsJson(rows),
        });
        yield* store.saveChunk(chunk);
        const last = rows[rows.length - 1];
        afterId = last === undefined ? afterId : last.id;
        current = yield* savePhase(
          store,
          current,
          MigrationPhaseSchema.cases.Exporting.make({
            lastCompletedChunk: {
              organizationId: selection.organizationId,
              table,
              chunkIndex,
            },
          }),
        );
        yield* checkpoint.pass("export.afterChunk");
        chunkIndex += 1;
      }
    }
  }
  const manifest = yield* store.buildManifest(record.organizations);
  yield* store.saveManifest(manifest);
  return yield* savePhase(
    store,
    current,
    MigrationPhaseSchema.cases.ManifestReady.make({ manifestChecksum: manifest.checksum }),
  );
});

const importRemaining = Effect.fn("Migrate.importRemaining")(function* (record: MigrationRecord) {
  const store = yield* ExportStore;
  const target = yield* OrganizationInventoryImport;
  const ids = yield* MigrationIds;
  const checkpoint = yield* MigrationCheckpoint;
  const manifest = yield* store.loadManifest();
  if (Option.isNone(manifest)) {
    return yield* Effect.fail(
      new ManifestIncomplete({ message: "Import requires a complete export manifest." }),
    );
  }
  const expectedChecksum = yield* manifestChecksumOf(record.phase);
  if (expectedChecksum !== manifest.value.checksum) {
    return yield* Effect.fail(
      new ManifestIncomplete({
        message: "Stored manifest checksum does not match the migration record.",
      }),
    );
  }
  let current = record;
  const incarnation = yield* ids.nextIncarnation();
  for (const selection of record.organizations) {
    yield* target.prepareImport(selection.organizationId, record.importId, incarnation);
    for (const table of BUSINESS_TABLES) {
      const chunks = yield* store.loadChunks(selection.organizationId, table);
      for (const chunk of chunks) {
        if (
          alreadyImported(
            record.organizations,
            current.phase,
            selection.organizationId,
            table,
            chunk.chunkIndex,
          )
        ) {
          continue;
        }
        yield* target.applyChunk(
          selection.organizationId,
          record.importId,
          table,
          chunk.chunkIndex,
          chunk.checksum,
          chunk.rowsJson,
        );
        current = yield* savePhase(
          store,
          current,
          MigrationPhaseSchema.cases.Importing.make({
            manifestChecksum: manifest.value.checksum,
            lastCompletedChunk: {
              organizationId: selection.organizationId,
              table,
              chunkIndex: chunk.chunkIndex,
            },
          }),
        );
        yield* checkpoint.pass("import.afterChunk");
      }
    }
  }
  return current;
});

const validateImported = Effect.fn("Migrate.validateImported")(function* (record: MigrationRecord) {
  const store = yield* ExportStore;
  const target = yield* OrganizationInventoryImport;
  const checkpoint = yield* MigrationCheckpoint;
  const ids = yield* MigrationIds;
  yield* checkpoint.pass("validate.before");
  const manifest = yield* store.loadManifest();
  if (Option.isNone(manifest)) {
    return yield* Effect.fail(
      new ManifestIncomplete({ message: "Validation requires a complete export manifest." }),
    );
  }
  for (const orgManifest of manifest.value.organizations) {
    yield* validateOrganization(target, orgManifest.organizationId, orgManifest);
  }
  for (const selection of record.organizations) {
    yield* target.markReady(selection.organizationId, record.importId);
  }
  const releaseId = yield* ids.nextReleaseId();
  return yield* savePhase(
    store,
    record,
    MigrationPhaseSchema.cases.Validated.make({
      manifestChecksum: manifest.value.checksum,
      releaseId,
    }),
  );
});

const publishValidated = Effect.fn("Migrate.publishValidated")(function* (record: MigrationRecord) {
  const store = yield* ExportStore;
  const directory = yield* DatasetReleaseDirectory;
  const checkpoint = yield* MigrationCheckpoint;
  if (record.phase._tag !== "Validated") {
    return yield* Effect.fail(
      new PublicationFailed({
        incompleteStep: "publishDataset",
        message: "Publication requires every organization to be validated.",
      }),
    );
  }
  const releaseId = record.phase.releaseId;
  const manifestChecksum = record.phase.manifestChecksum;
  const entries: Array<ReleaseEntry> = record.organizations.map((selection) => ({
    organizationId: selection.organizationId,
    objectName: selection.objectName,
    importId: record.importId,
    status: "ready" as const,
  }));
  for (const selection of record.organizations) {
    yield* directory.ensureOrganization(selection.organizationId);
  }
  yield* directory.stageRelease(releaseId, entries);
  yield* checkpoint.pass("publish.beforeActivate");
  yield* directory.activateRelease(releaseId).pipe(
    Effect.catchTag("Migrate.PublicationFailed", (error) =>
      Effect.gen(function* () {
        const active = yield* directory.readActiveRelease();
        if (Option.isSome(active) && active.value.releaseId === releaseId) {
          return active.value;
        }
        return yield* Effect.fail(error);
      }),
    ),
  );
  yield* checkpoint.pass("publish.afterActivate");
  const publishedAt = yield* Clock.currentTimeMillis;
  return yield* savePhase(
    store,
    record,
    MigrationPhaseSchema.cases.Completed.make({
      manifestChecksum,
      releaseId,
      publishedAt,
    }),
  ).pipe(
    Effect.map((completed) => {
      if (completed.phase._tag !== "Completed") {
        return CompletedMigrationSchema.make({
          migrationId: record.migrationId,
          importId: record.importId,
          releaseId,
          publishedAt,
          organizationCount: record.organizations.length,
          manifestChecksum,
        });
      }
      return completedFrom(completed, completed.phase);
    }),
  );
});

const beginRecord = Effect.fn("Migrate.beginRecord")(function* (request: MigrationRequest) {
  const source = yield* SourceCatalog;
  const store = yield* ExportStore;
  const ids = yield* MigrationIds;
  const liveIdentity = yield* decodeSourceIdentity(yield* source.identity()).pipe(
    Effect.mapError(
      () =>
        new ConfigurationError({
          message: "Source identity is empty or invalid.",
        }),
    ),
  );
  if (liveIdentity !== request.sourceIdentity) {
    return yield* Effect.fail(
      new ConfigurationError({
        message: "Requested source identity does not match the connected source.",
      }),
    );
  }
  const existing = yield* store.loadRecord();
  if (Option.isSome(existing)) {
    const record = existing.value;
    if (record.sourceIdentity !== liveIdentity) {
      return yield* Effect.fail(
        new ConfigurationError({
          message: "Existing migration record belongs to a different source.",
        }),
      );
    }
    if (!organizationsMatch(record.organizations, request.organizations)) {
      return yield* Effect.fail(
        new ConfigurationError({
          message: "Existing migration record selected different organizations.",
        }),
      );
    }
    if (
      record.schemaVersion !== POSTGRES_SCHEMA_VERSION ||
      record.mappingVersion !== SQLITE_MAPPING_VERSION
    ) {
      return yield* Effect.fail(
        new ConfigurationError({
          message: "Existing migration record uses incompatible schema versions.",
        }),
      );
    }
    return record;
  }
  const record = MigrationRecordSchema.make({
    migrationId: yield* ids.nextMigrationId(),
    sourceIdentity: liveIdentity,
    schemaVersion: POSTGRES_SCHEMA_VERSION,
    mappingVersion: SQLITE_MAPPING_VERSION,
    organizations: request.organizations,
    importId: yield* ids.nextImportId(),
    phase: MigrationPhaseSchema.cases.Checking.make({}),
  });
  yield* store.saveRecord(record);
  return record;
});

export const runMigration = Effect.fn("Migrate.run")(function* (request: MigrationRequest) {
  const source = yield* SourceCatalog;
  const store = yield* ExportStore;
  let record = yield* beginRecord(request);
  if (record.phase._tag === "Completed") {
    return completedFrom(record, record.phase);
  }
  yield* source.freezeWrites();
  if (record.phase._tag === "Checking") {
    record = yield* savePhase(store, record, MigrationPhaseSchema.cases.Frozen.make({}));
  }
  if (record.phase._tag === "Frozen" || record.phase._tag === "Exporting") {
    record = yield* exportRemaining(record, request.chunkSize);
  }
  if (record.phase._tag === "ManifestReady" || record.phase._tag === "Importing") {
    record = yield* importRemaining(record);
    record = yield* validateImported(record);
  }
  if (record.phase._tag === "Validated") {
    return yield* publishValidated(record);
  }
  if (record.phase._tag === "Completed") {
    return completedFrom(record, record.phase);
  }
  return yield* Effect.fail(
    new ConfigurationError({
      message: "Migration stopped before a complete result was recorded.",
    }),
  );
});
