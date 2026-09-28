import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import * as Schema from "effect/Schema";
import type { IpcMain } from "electron";

import {
  LegacyArchive,
  LegacyArchiveFile,
  LegacyMigrationReport,
  LegacyMigrationReportFile,
  LegacyMigrationState,
  LegacyOrganizationId,
  LEGACY_MIGRATION_VERSION,
  type LegacyPurgeResult,
} from "../src/lib/legacy-migration/model";
import { assertTrustedIpcSender } from "./ipc-sender";
import {
  LEGACY_MIGRATION_ARCHIVE_EXISTS_CHANNEL,
  LEGACY_MIGRATION_PURGE_CHANNEL,
  LEGACY_MIGRATION_READ_ARCHIVE_CHANNEL,
  LEGACY_MIGRATION_READ_STATE_CHANNEL,
  LEGACY_MIGRATION_WRITE_ARCHIVE_CHANNEL,
  LEGACY_MIGRATION_WRITE_REPORT_CHANNEL,
  LEGACY_MIGRATION_WRITE_STATE_CHANNEL,
  type LegacyArchiveWritten,
} from "./legacy-migration-channels";

type IpcPayload = Parameters<Parameters<IpcMain["handle"]>[1]>[1];

export const LEGACY_STATE_DIRECTORY = "legacy-migration";
export const LEGACY_BACKUP_DIRECTORY = "legacy-backup";
export const LEGACY_REPORT_FILE = "legacy-migration-report.json";

const DEAD_DIRECTORIES = ["organizations", "locked"] as const;
const DEAD_FILES = ["clerk-tokens.json"] as const;
const OFFLINE_STORE = /^offline-store\.db(?:-[a-z-]+)?$/u;
const LEGACY_CONFIG_FILE = "config.json";
const LEGACY_CONFIG_KEY = "better-auth";

const decodeOrganizationId = Schema.decodeUnknownSync(LegacyOrganizationId);
const decodeArchiveFile = Schema.decodeUnknownSync(LegacyArchiveFile);
const decodeState = Schema.decodeUnknownSync(LegacyMigrationState);
const decodeStateText = Schema.decodeUnknownSync(Schema.fromJsonString(LegacyMigrationState));
const decodeArchive = Schema.decodeUnknownSync(LegacyArchive);
const decodeArchiveText = Schema.decodeUnknownSync(Schema.fromJsonString(LegacyArchive));
const decodeReport = Schema.decodeUnknownSync(LegacyMigrationReport);
const decodeReportFileText = Schema.decodeUnknownOption(
  Schema.fromJsonString(LegacyMigrationReportFile),
);
const decodeConfigText = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const encodeState = Schema.encodeSync(Schema.fromJsonString(LegacyMigrationState));
const encodeArchive = Schema.encodeSync(Schema.fromJsonString(LegacyArchive));
const encodeReportFile = Schema.encodeSync(Schema.fromJsonString(LegacyMigrationReportFile));

const isMissing = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const readOptionalText = async (file: string) => {
  try {
    return await readFile(file, "utf8");
  } catch (cause) {
    if (isMissing(cause)) return null;
    throw cause;
  }
};

const syncDirectory = async (directory: string) => {
  const handle = await open(directory, "r").catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
};

export const writeFileDurably = async (file: string, contents: string) => {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  await syncDirectory(directory);
};

const onlyLegacyAuthConfig = async (file: string) => {
  const text = await readOptionalText(file);
  if (text === null) return false;
  const decoded = decodeConfigText(text);
  if (decoded._tag === "None") return false;
  const keys = Object.keys(decoded.value);
  return keys.length === 1 && keys[0] === LEGACY_CONFIG_KEY;
};

export const purgeDeadLegacyEntries = async (userDataPath: string): Promise<LegacyPurgeResult> => {
  const entries = await readdir(userDataPath).catch((cause: unknown): Array<string> => {
    if (isMissing(cause)) return [];
    throw cause;
  });
  const targets = entries.filter(
    (entry) =>
      DEAD_DIRECTORIES.some((name) => name === entry) ||
      DEAD_FILES.some((name) => name === entry) ||
      OFFLINE_STORE.test(entry),
  );
  if (entries.includes(LEGACY_CONFIG_FILE)) {
    if (await onlyLegacyAuthConfig(path.join(userDataPath, LEGACY_CONFIG_FILE))) {
      targets.push(LEGACY_CONFIG_FILE);
    }
  }
  for (const target of targets) {
    await rm(path.join(userDataPath, target), { recursive: true, force: true });
  }
  return { removed: targets };
};

export const makeLegacyMigrationStore = (userDataPath: string) => {
  const stateDirectory = path.join(userDataPath, LEGACY_STATE_DIRECTORY);
  const backupDirectory = path.join(userDataPath, LEGACY_BACKUP_DIRECTORY);
  const reportFile = path.join(userDataPath, LEGACY_REPORT_FILE);
  const stateFile = (organizationId: string) =>
    path.join(stateDirectory, `${decodeOrganizationId(organizationId)}.json`);
  const archivePath = (file: string) => path.join(backupDirectory, decodeArchiveFile(file));

  return {
    readState: async (organizationId: string): Promise<LegacyMigrationState | null> => {
      const text = await readOptionalText(stateFile(organizationId));
      return text === null ? null : decodeStateText(text);
    },
    writeState: async (state: LegacyMigrationState) => {
      await writeFileDurably(stateFile(state.organizationId), encodeState(decodeState(state)));
    },
    writeArchive: async (archive: LegacyArchive): Promise<LegacyArchiveWritten> => {
      const file = decodeArchiveFile(`${archive.organizationId}-${Date.now()}.json`);
      await writeFileDurably(archivePath(file), encodeArchive(decodeArchive(archive)));
      return { file };
    },
    readArchive: async (file: string) =>
      decodeArchiveText(await readFile(archivePath(file), "utf8")),
    archiveExists: async (file: string) => {
      const found = await stat(archivePath(file)).catch((cause: unknown) => {
        if (isMissing(cause)) return null;
        throw cause;
      });
      return found !== null && found.isFile() && found.size > 0;
    },
    writeReport: async (report: LegacyMigrationReport) => {
      const decodedReport = decodeReport(report);
      const existing = await readOptionalText(reportFile);
      const decoded = existing === null ? null : decodeReportFileText(existing);
      const organizations = decoded?._tag === "Some" ? decoded.value.organizations : {};
      await writeFileDurably(
        reportFile,
        encodeReportFile({
          version: LEGACY_MIGRATION_VERSION,
          organizations: { ...organizations, [decodedReport.organizationId]: decodedReport },
        }),
      );
    },
    purgeDeadFiles: () => purgeDeadLegacyEntries(userDataPath),
  };
};

export const registerLegacyMigrationIpc = (options: {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  readonly userDataPath: string;
  readonly allowedOrigins: () => ReadonlyArray<string>;
}) => {
  const store = makeLegacyMigrationStore(options.userDataPath);
  const channels: Array<string> = [];
  const handle = <A>(channel: string, run: (input: IpcPayload) => Promise<A>) => {
    channels.push(channel);
    options.ipcMain.handle(channel, (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      return run(input);
    });
  };
  handle(LEGACY_MIGRATION_READ_STATE_CHANNEL, (input) =>
    store.readState(decodeOrganizationId(input)),
  );
  handle(LEGACY_MIGRATION_WRITE_STATE_CHANNEL, (input) => store.writeState(decodeState(input)));
  handle(LEGACY_MIGRATION_WRITE_ARCHIVE_CHANNEL, (input) =>
    store.writeArchive(decodeArchive(input)),
  );
  handle(LEGACY_MIGRATION_READ_ARCHIVE_CHANNEL, (input) =>
    store.readArchive(decodeArchiveFile(input)),
  );
  handle(LEGACY_MIGRATION_ARCHIVE_EXISTS_CHANNEL, (input) =>
    store.archiveExists(decodeArchiveFile(input)),
  );
  handle(LEGACY_MIGRATION_WRITE_REPORT_CHANNEL, (input) => store.writeReport(decodeReport(input)));
  handle(LEGACY_MIGRATION_PURGE_CHANNEL, () => store.purgeDeadFiles());
  return () => {
    for (const channel of channels) options.ipcMain.removeHandler(channel);
  };
};
