import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";

import { layer } from "./index";
import {
  authMigrationsFolder,
  durableObjectMigrationsFolder,
  migrationsFolder,
  store,
} from "./test-support";

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

// Three databases, three migration sets, all SQLite now: the client store, the
// per-organization Durable Object store, and the D1 identity database. This
// guards the boundary between them — each must hold only what belongs to it.
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

  // The client owns the outbox and its sync cursor.
  expect(local).toContain(table("invoices"));
  expect(local).toContain(table("sync_outbox"));
  expect(local).toContain(table("sync_state"));
  for (const name of [...authTables, "sync_inbox", "sync_change_log"]) {
    expect(local).not.toContain(table(name));
  }

  // The Durable Object owns the server-side inbox and change log, and shares the
  // store tables with the client.
  expect(durableObject).toContain(table("invoices"));
  expect(durableObject).toContain(table("sync_inbox"));
  expect(durableObject).toContain(table("sync_change_log"));
  for (const name of [...authTables, "sync_outbox", "sync_state"]) {
    expect(durableObject).not.toContain(table(name));
  }

  // D1 holds identity only — no store or sync tables.
  for (const name of authTables) expect(auth).toContain(table(name));
  for (const name of ["invoices", "products", "sync_outbox", "sync_inbox"]) {
    expect(auth).not.toContain(table(name));
  }
});

test("migrations are idempotent and preserve existing products", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const dataDir = path.join(directory, "data");

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
