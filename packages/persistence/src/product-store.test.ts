import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program } from "./index";
import { migrationsFolder } from "./test-support";

test("product CRUD remains available without sync configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ dataDir: path.join(directory, "pglite"), migrationsFolder }),
  );

  try {
    const created = await runtime.runPromise(
      program.createProduct({
        name: "  Panadol  ",
        categoryId: "medicine",
        aisle: "A3",
        composition: "Paracetamol",
        strength: "500mg",
        unitsPerPack: 10,
        packPrice: 1500,
        unitPrice: 200,
      }),
    );
    expect(created.name).toBe("Panadol");
    expect(created.category).toMatchObject({ id: "medicine", name: "Medicine" });
    expect(await runtime.runPromise(program.listCategories)).toHaveLength(3);
    expect(await runtime.runPromise(program.listProducts)).toEqual([created]);
    expect(await runtime.runPromise(program.getProduct(created.id))).toEqual(created);

    const updated = await runtime.runPromise(
      program.updateProduct({
        id: created.id,
        name: "Panadol Extra",
        categoryId: "medicine",
        aisle: "A4",
        composition: "Paracetamol + Caffeine",
        strength: "500mg",
        unitsPerPack: 12,
        packPrice: 1800,
        unitPrice: 150,
      }),
    );
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.name).toBe("Panadol Extra");
    expect(updated.unitsPerPack).toBe(12);

    await runtime.runPromise(program.deleteProduct(created.id));
    expect(await runtime.runPromise(program.listProducts)).toEqual([]);
    expect(await runtime.runPromise(program.getSyncStatus)).toMatchObject({
      configured: false,
      phase: "local-only",
    });
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("category and units default when omitted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ dataDir: path.join(directory, "pglite"), migrationsFolder }),
  );

  try {
    const created = await runtime.runPromise(
      program.createProduct({
        name: "Baby Shampoo",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: 45000,
        unitPrice: null,
      }),
    );
    expect(created.category).toMatchObject({ id: "general", name: "General" });
    expect(created.unitsPerPack).toBe(1);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
