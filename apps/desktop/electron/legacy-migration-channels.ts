import type {
  LegacyArchive,
  LegacyMigrationReport,
  LegacyMigrationState,
  LegacyPurgeResult,
} from "../src/lib/legacy-migration/model";

export const LEGACY_MIGRATION_READ_STATE_CHANNEL = "legacy-migration:read-state";
export const LEGACY_MIGRATION_WRITE_STATE_CHANNEL = "legacy-migration:write-state";
export const LEGACY_MIGRATION_WRITE_ARCHIVE_CHANNEL = "legacy-migration:write-archive";
export const LEGACY_MIGRATION_READ_ARCHIVE_CHANNEL = "legacy-migration:read-archive";
export const LEGACY_MIGRATION_ARCHIVE_EXISTS_CHANNEL = "legacy-migration:archive-exists";
export const LEGACY_MIGRATION_WRITE_REPORT_CHANNEL = "legacy-migration:write-report";
export const LEGACY_MIGRATION_PURGE_CHANNEL = "legacy-migration:purge-dead-files";

export type LegacyArchiveWritten = {
  readonly file: string;
};

export type LegacyMigrationBridge = {
  readonly readState: (organizationId: string) => Promise<LegacyMigrationState | null>;
  readonly writeState: (state: LegacyMigrationState) => Promise<void>;
  readonly writeArchive: (archive: LegacyArchive) => Promise<LegacyArchiveWritten>;
  readonly readArchive: (file: string) => Promise<LegacyArchive>;
  readonly archiveExists: (file: string) => Promise<boolean>;
  readonly writeReport: (report: LegacyMigrationReport) => Promise<void>;
  readonly purgeDeadFiles: () => Promise<LegacyPurgeResult>;
};
