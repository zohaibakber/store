import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

import {
  authMigrationsFolder,
  durableObjectMigrationsFolder,
  migrationsFolder,
  store,
  withTestStore,
} from "../lib/store";

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

test("each database's migrations contain only its own tables", async () => {
  const local = await readMigrations(migrationsFolder);
  const durableObject = await readMigrations(durableObjectMigrationsFolder);
  const auth = await readMigrations(authMigrationsFolder);

  const table = (name: string) => `CREATE TABLE \`${name}\``;
  const authTables = [
    "user",
    "session",
    "account",
    "verification",
    "organization",
    "member",
    "invitation",
  ];

  expect(local).toContain(table("invoices"));
  expect(local).toContain(table("sync_outbox"));
  expect(local).toContain(table("sync_state"));
  for (const name of [...authTables, "sync_inbox", "sync_change_log"]) {
    expect(local).not.toContain(table(name));
  }

  expect(durableObject).toContain(table("invoices"));
  expect(durableObject).toContain(table("sync_inbox"));
  expect(durableObject).toContain(table("sync_change_log"));
  for (const name of [...authTables, "sync_outbox", "sync_state"]) {
    expect(durableObject).not.toContain(table(name));
  }

  for (const name of authTables) expect(auth).toContain(table(name));
  for (const name of ["invoices", "products", "sync_outbox", "sync_inbox"]) {
    expect(auth).not.toContain(table(name));
  }
});

test("migrations are idempotent and preserve existing products", async () => {
  await withTestStore(async ({ runtime, makeRuntime }) => {
    const created = await runtime.runPromise(
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
    await runtime.dispose();

    const secondRuntime = makeRuntime();
    expect(await secondRuntime.runPromise(store((store) => store.listProducts))).toEqual([created]);
  });
});
