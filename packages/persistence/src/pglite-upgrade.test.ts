import { PGlite } from "@electric-sql/pglite";
import * as Effect from "effect/Effect";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite as PGlite04 } from "pglite-04";
import { describe, expect, it } from "vitest";
import { upgradePgliteDataDir } from "./pglite-upgrade";

describe("upgradePgliteDataDir", () => {
  it("migrates a PostgreSQL 17 PGlite directory without losing rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "store-pglite-upgrade-"));
    const dataDir = path.join(directory, "pglite");
    const legacy = await PGlite04.create(dataDir);
    await legacy.exec(`
      CREATE TABLE products (id text PRIMARY KEY, name text NOT NULL);
      INSERT INTO products (id, name) VALUES ('product-1', 'Panadol');
    `);
    await legacy.close();

    await Effect.runPromise(upgradePgliteDataDir(dataDir));

    expect((await readFile(path.join(dataDir, "PG_VERSION"), "utf8")).trim()).toBe("18");
    expect((await readFile(path.join(`${dataDir}.pg17-backup`, "PG_VERSION"), "utf8")).trim()).toBe(
      "17",
    );

    const upgraded = await PGlite.create(dataDir);
    try {
      const result = await upgraded.query<{ id: string; name: string }>(
        "SELECT id, name FROM products",
      );
      expect(result.rows).toEqual([{ id: "product-1", name: "Panadol" }]);
    } finally {
      await upgraded.close();
    }
  });

  it("leaves a current PGlite directory unchanged", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "store-pglite-current-"));
    const dataDir = path.join(directory, "pglite");
    const current = await PGlite.create(dataDir);
    await current.close();

    await Effect.runPromise(upgradePgliteDataDir(dataDir));

    expect((await readFile(path.join(dataDir, "PG_VERSION"), "utf8")).trim()).toBe("18");
  });
});
