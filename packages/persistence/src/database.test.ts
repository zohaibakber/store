import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";

import { layer } from "./index";
import { migrationsFolder, remoteMigrationsFolder, store } from "./test-support";

const readMigrations = async (folder: string) => {
  const entries = await readdir(folder, { withFileTypes: true });
  const migrationFolders = entries.filter((entry) => entry.isDirectory());
  if (migrationFolders.length === 0) throw new Error(`No migrations found in ${folder}`);
  const migrations = await Promise.all(
    migrationFolders.map((entry) =>
      readFile(path.join(folder, entry.name, "migration.sql"), "utf8"),
    ),
  );
  return migrations.join("\n");
};

test("local migrations exclude remote-only auth and sync tables", async () => {
  const localMigration = await readMigrations(migrationsFolder);
  const remoteMigration = await readMigrations(remoteMigrationsFolder);

  expect(localMigration).toContain('CREATE TABLE "invoices"');
  expect(localMigration).toContain('CREATE TABLE "sync_outbox"');
  for (const remoteOnlyTable of [
    "user",
    "session",
    "account",
    "verification",
    "organization",
    "member",
    "invitation",
    "sync_inbox",
    "sync_change_log",
  ]) {
    expect(localMigration).not.toContain(`CREATE TABLE "${remoteOnlyTable}"`);
  }

  expect(remoteMigration).toContain('CREATE TABLE "user"');
  expect(remoteMigration).toContain('CREATE TABLE "sync_inbox"');
  expect(remoteMigration).not.toContain('CREATE TABLE "sync_outbox"');
  expect(remoteMigration).not.toContain('CREATE TABLE "sync_state"');
});

test("migrations are idempotent and preserve existing products", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const dataDir = path.join(directory, "pglite");

  try {
    const firstRuntime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
    const created = await firstRuntime.runPromise(
      store((store) =>
        store.createProduct({
          name: "Aspirin",
          aisle: null,
          composition: null,
          strength: null,
          packPrice: null,
          unitPrice: null,
        }),
      ),
    );
    await firstRuntime.dispose();

    const secondRuntime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
    expect(await secondRuntime.runPromise(store((store) => store.listProducts))).toEqual([created]);
    await secondRuntime.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
