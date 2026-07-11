import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program } from "./index";

const migrationsFolder = path.resolve(import.meta.dirname, "../../database/drizzle");

test("product CRUD remains available without sync configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ path: path.join(directory, "store.db"), migrationsFolder }),
  );

  try {
    const created = await runtime.runPromise(
      program.createProduct({
        name: "  Panadol  ",
        category: "medicine",
        barcode: null,
        composition: "Paracetamol",
        strength: "500mg",
        unitsPerPack: 10,
        costPrice: 900,
        packPrice: 1500,
        unitPrice: 200,
      }),
    );
    expect(created.name).toBe("Panadol");
    expect(created.category).toBe("medicine");
    expect(await runtime.runPromise(program.listProducts)).toEqual([created]);
    expect(await runtime.runPromise(program.getProduct(created.id))).toEqual(created);

    const updated = await runtime.runPromise(
      program.updateProduct({
        id: created.id,
        name: "Panadol Extra",
        category: "medicine",
        barcode: "123456",
        composition: "Paracetamol + Caffeine",
        strength: "500mg",
        unitsPerPack: 12,
        costPrice: 1000,
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
    layer({ path: path.join(directory, "store.db"), migrationsFolder }),
  );

  try {
    const created = await runtime.runPromise(
      program.createProduct({
        name: "Baby Shampoo",
        barcode: null,
        composition: null,
        strength: null,
        costPrice: null,
        packPrice: 45000,
        unitPrice: null,
      }),
    );
    expect(created.category).toBe("general");
    expect(created.unitsPerPack).toBe(1);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrations are idempotent and preserve existing products", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const databasePath = path.join(directory, "store.db");

  try {
    const firstRuntime = ManagedRuntime.make(layer({ path: databasePath, migrationsFolder }));
    const created = await firstRuntime.runPromise(
      program.createProduct({
        name: "Aspirin",
        barcode: null,
        composition: null,
        strength: null,
        costPrice: null,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await firstRuntime.dispose();

    const secondRuntime = ManagedRuntime.make(layer({ path: databasePath, migrationsFolder }));
    expect(await secondRuntime.runPromise(program.listProducts)).toEqual([created]);
    await secondRuntime.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
