import { inventoryReplicaScope } from "@store/client-db/scope";
import * as Schema from "effect/Schema";

export const LEGACY_DATABASE_PREFIX = "powersync-inventory-";
export const LEGACY_SALE_OUTBOX_PREFIX = "tabaaq.sale-outbox.";
export const LEGACY_MIGRATION_VERSION = 1;

export const LegacyOrganizationId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/u),
);

export const LegacyArchiveFile = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,128}-[0-9]{1,16}\.json$/u),
);

const fnv1a = (value: string) => {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const legacyDatabaseName = (apiBaseUrl: string, organizationId: string) =>
  `${LEGACY_DATABASE_PREFIX}${fnv1a(inventoryReplicaScope(apiBaseUrl, organizationId))}.sqlite`;

export const legacySaleOutboxKey = (organizationId: string) =>
  `${LEGACY_SALE_OUTBOX_PREFIX}${organizationId}`;

export const LegacyCrudRow = Schema.Struct({
  id: Schema.Int,
  tx_id: Schema.NullOr(Schema.Int),
  data: Schema.String,
});
export type LegacyCrudRow = typeof LegacyCrudRow.Type;

export const LegacyRow = Schema.Record(Schema.String, Schema.Unknown);
export type LegacyRow = typeof LegacyRow.Type;

export const LegacyDatabaseCapture = Schema.Struct({
  name: Schema.String,
  crud: Schema.Array(LegacyCrudRow),
  tables: Schema.Record(Schema.String, Schema.Array(LegacyRow)),
});
export type LegacyDatabaseCapture = typeof LegacyDatabaseCapture.Type;

export const LegacySaleOutboxCapture = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
});
export type LegacySaleOutboxCapture = typeof LegacySaleOutboxCapture.Type;

export const LegacyArchive = Schema.Struct({
  version: Schema.Literal(LEGACY_MIGRATION_VERSION),
  organizationId: LegacyOrganizationId,
  apiBaseUrl: Schema.String,
  capturedAt: Schema.Number,
  databases: Schema.Array(LegacyDatabaseCapture),
  saleOutbox: Schema.Array(LegacySaleOutboxCapture),
});
export type LegacyArchive = typeof LegacyArchive.Type;

export const LegacyOperationKind = Schema.Literals(["catalog", "sale"]);
export type LegacyOperationKind = typeof LegacyOperationKind.Type;

export const LegacyOperationRecord = Schema.Struct({
  operationId: Schema.String,
  kind: LegacyOperationKind,
  outcome: Schema.Literals(["queued", "skipped", "failed"]),
  reason: Schema.String,
  message: Schema.NullOr(Schema.String),
  legacy: Schema.Unknown,
});
export type LegacyOperationRecord = typeof LegacyOperationRecord.Type;

export const LegacyMigrationPhase = Schema.Literals(["archived", "enqueued", "reported", "purged"]);
export type LegacyMigrationPhase = typeof LegacyMigrationPhase.Type;

export const LegacyMigrationNotice = Schema.Struct({
  carriedOver: Schema.Int,
  rejected: Schema.Int,
});
export type LegacyMigrationNotice = typeof LegacyMigrationNotice.Type;

export const LegacyMigrationState = Schema.Struct({
  version: Schema.Literal(LEGACY_MIGRATION_VERSION),
  organizationId: LegacyOrganizationId,
  phase: LegacyMigrationPhase,
  archiveFile: LegacyArchiveFile,
  databases: Schema.Array(Schema.String),
  saleOutboxKeys: Schema.Array(Schema.String),
  runs: Schema.Int,
  operations: Schema.Array(LegacyOperationRecord),
  notice: Schema.NullOr(LegacyMigrationNotice),
  notified: Schema.Boolean,
  updatedAt: Schema.Number,
});
export type LegacyMigrationState = typeof LegacyMigrationState.Type;

export const LegacyReportOutcome = Schema.Literals([
  "pending",
  "accepted",
  "rejected",
  "abandoned",
  "skipped",
  "notQueued",
]);
export type LegacyReportOutcome = typeof LegacyReportOutcome.Type;

export const LegacyReportOperation = Schema.Struct({
  operationId: Schema.String,
  kind: LegacyOperationKind,
  outcome: LegacyReportOutcome,
  reason: Schema.String,
  code: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  legacy: Schema.Unknown,
});
export type LegacyReportOperation = typeof LegacyReportOperation.Type;

export const LegacyUndecodableEntry = Schema.Struct({
  source: Schema.Literals(["crud", "saleOutbox", "sale", "catalog"]),
  reference: Schema.String,
  message: Schema.String,
  raw: Schema.Unknown,
});
export type LegacyUndecodableEntry = typeof LegacyUndecodableEntry.Type;

export const LegacyMigrationReport = Schema.Struct({
  version: Schema.Literal(LEGACY_MIGRATION_VERSION),
  organizationId: LegacyOrganizationId,
  generatedAt: Schema.Number,
  complete: Schema.Boolean,
  archiveFile: LegacyArchiveFile,
  counts: Schema.Struct({
    carriedOver: Schema.Int,
    accepted: Schema.Int,
    rejected: Schema.Int,
    skipped: Schema.Int,
    notQueued: Schema.Int,
    undecodable: Schema.Int,
  }),
  operations: Schema.Array(LegacyReportOperation),
  undecodable: Schema.Array(LegacyUndecodableEntry),
});
export type LegacyMigrationReport = typeof LegacyMigrationReport.Type;

export const LegacyMigrationReportFile = Schema.Struct({
  version: Schema.Literal(LEGACY_MIGRATION_VERSION),
  organizations: Schema.Record(Schema.String, LegacyMigrationReport),
});
export type LegacyMigrationReportFile = typeof LegacyMigrationReportFile.Type;

export const LegacyPurgeResult = Schema.Struct({
  removed: Schema.Array(Schema.String),
});
export type LegacyPurgeResult = typeof LegacyPurgeResult.Type;
