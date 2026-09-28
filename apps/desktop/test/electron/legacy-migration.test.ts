import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_BACKUP_DIRECTORY,
  LEGACY_REPORT_FILE,
  makeLegacyMigrationStore,
  purgeDeadLegacyEntries,
} from "../../electron/legacy-migration";
import type {
  LegacyArchive,
  LegacyMigrationReport,
  LegacyMigrationState,
} from "../../src/lib/legacy-migration/model";

const directories: Array<string> = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const userData = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "legacy-migration-"));
  directories.push(directory);
  return directory;
};

const state = (archiveFile: string): LegacyMigrationState => ({
  version: 1,
  organizationId: "org_1",
  phase: "archived",
  archiveFile,
  databases: ["powersync-inventory-3d268b3c.sqlite"],
  saleOutboxKeys: ["tabaaq.sale-outbox.org_1"],
  runs: 0,
  operations: [],
  notice: null,
  notified: false,
  updatedAt: 1,
});

const report = (organizationId: string): LegacyMigrationReport => ({
  version: 1,
  organizationId,
  generatedAt: 2,
  complete: true,
  archiveFile: `${organizationId}-1.json`,
  counts: { carriedOver: 1, accepted: 1, rejected: 0, skipped: 0, notQueued: 0, undecodable: 0 },
  operations: [],
  undecodable: [],
});

describe("legacy migration store", () => {
  it("writes the archive and state durably and reads them back", async () => {
    const root = userData();
    const store = makeLegacyMigrationStore(root);
    const archive: LegacyArchive = {
      version: 1,
      organizationId: "org_1",
      apiBaseUrl: "https://api.tabaaq.app",
      capturedAt: 5,
      databases: [{ name: "powersync-inventory-3d268b3c.sqlite", crud: [], tables: {} }],
      saleOutbox: [{ key: "tabaaq.sale-outbox.org_1", value: "{}" }],
    };
    const { file } = await store.writeArchive(archive);
    expect(file).toMatch(/^org_1-[0-9]+\.json$/u);
    expect(await store.archiveExists(file)).toBe(true);
    expect(await store.readArchive(file)).toEqual(archive);
    expect(readdirSync(path.join(root, LEGACY_BACKUP_DIRECTORY))).toEqual([file]);

    expect(await store.readState("org_1")).toBeNull();
    await store.writeState(state(file));
    expect(await store.readState("org_1")).toEqual(state(file));
    expect(readdirSync(path.join(root, "legacy-migration"))).toEqual(["org_1.json"]);
  });

  it("rejects archive names and organization ids that could escape the backup folder", async () => {
    const store = makeLegacyMigrationStore(userData());
    await expect(store.archiveExists("../device-id")).rejects.toThrow();
    await expect(store.readArchive("org_1-1.json/../../auth")).rejects.toThrow();
    await expect(store.readState("../auth")).rejects.toThrow();
    await expect(
      store.writeState({ ...state("org_1-1.json"), organizationId: "a/b" }),
    ).rejects.toThrow();
  });

  it("refuses corrupt state instead of treating it as missing", async () => {
    const root = userData();
    mkdirSync(path.join(root, "legacy-migration"));
    writeFileSync(path.join(root, "legacy-migration", "org_1.json"), '{"phase":"purged"}');
    await expect(makeLegacyMigrationStore(root).readState("org_1")).rejects.toThrow();
  });

  it("merges reports per organization", async () => {
    const root = userData();
    const store = makeLegacyMigrationStore(root);
    await store.writeReport(report("org_1"));
    await store.writeReport(report("org_2"));
    const written = JSON.parse(readFileSync(path.join(root, LEGACY_REPORT_FILE), "utf8"));
    expect(Object.keys(written.organizations)).toEqual(["org_1", "org_2"]);
  });
});

describe("purgeDeadLegacyEntries", () => {
  it("removes only the dead Clerk-era entries and keeps live and Chromium-owned data", async () => {
    const root = userData();
    for (const directory of [
      "organizations/org_old",
      "locked",
      "auth",
      "replicas",
      "legacy-backup",
      "IndexedDB",
      "Local Storage",
    ]) {
      mkdirSync(path.join(root, directory), { recursive: true });
    }
    for (const file of [
      "offline-store.db",
      "offline-store.db-wal",
      "offline-store.db-shm",
      "clerk-tokens.json",
      "device-id",
      "Preferences",
      "offline-store.dbx",
    ]) {
      writeFileSync(path.join(root, file), "x");
    }
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({ "better-auth": { token: "t" } }),
    );

    const result = await purgeDeadLegacyEntries(root);

    expect([...result.removed].sort()).toEqual([
      "clerk-tokens.json",
      "config.json",
      "locked",
      "offline-store.db",
      "offline-store.db-shm",
      "offline-store.db-wal",
      "organizations",
    ]);
    expect(readdirSync(root).sort()).toEqual([
      "IndexedDB",
      "Local Storage",
      "Preferences",
      "auth",
      "device-id",
      "legacy-backup",
      "offline-store.dbx",
      "replicas",
    ]);
  });

  it("keeps config.json when it holds anything besides the old auth key", async () => {
    const root = userData();
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({ "better-auth": {}, windowBounds: { width: 1 } }),
    );
    expect((await purgeDeadLegacyEntries(root)).removed).toEqual([]);
    expect(existsSync(path.join(root, "config.json"))).toBe(true);
  });
});
