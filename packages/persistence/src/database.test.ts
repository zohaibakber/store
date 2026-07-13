import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program } from "./index";
import { migrationsFolder } from "./test-support";

test("migrations are idempotent and preserve existing products", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const dataDir = path.join(directory, "pglite");

  try {
    const firstRuntime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
    const created = await firstRuntime.runPromise(
      program.createProduct({
        name: "Aspirin",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await firstRuntime.dispose();

    const secondRuntime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
    expect(await secondRuntime.runPromise(program.listProducts)).toEqual([created]);
    await secondRuntime.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
