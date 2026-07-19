import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ImportInventoryLine } from "@store/contracts";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program } from "./index";
import { migrationsFolder, readOutbox } from "./test-support";

const importLine = (name: string, productId: string | null = null): ImportInventoryLine => ({
  name,
  productId,
  batchNumber: `${name.trim().toLocaleUpperCase()}-1`,
  expiresAt: null,
  unitsPerPack: 10,
  packQuantity: 2,
  unitQuantity: 1,
  packPrice: 1_000,
});

test("bulk inventory import creates one ordered outbox operation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-inventory-import-"));
  const dataDir = path.join(directory, "pglite");
  let runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));

  try {
    const existing = await runtime.runPromise(
      program.createProduct({
        name: "Existing product",
        categoryId: "general",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 6,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await runtime.dispose();
    const before = await readOutbox(dataDir);
    runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));

    await expect(
      runtime.runPromise(
        program.importInventory({
          categoryId: "general",
          lines: [importLine("Aspirin"), importLine("Existing product", existing.id)],
        }),
      ),
    ).resolves.toEqual({ createdProducts: 1, createdBatches: 2 });

    const storedProducts = await runtime.runPromise(program.listProducts);
    const aspirin = storedProducts.find((product) => product.name === "Aspirin");
    const reloadedExisting = storedProducts.find((product) => product.id === existing.id);
    expect(aspirin?.batches).toHaveLength(1);
    expect(reloadedExisting?.batches).toHaveLength(1);
    if (!aspirin) throw new Error("Imported product was not found");
    expect(await runtime.runPromise(program.listStockMovements(aspirin.id))).toHaveLength(1);
    expect(await runtime.runPromise(program.listStockMovements(existing.id))).toHaveLength(1);

    await runtime.dispose();
    const after = await readOutbox(dataDir);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.payload.map((change) => change.entity)).toEqual([
      "product",
      "batch",
      "batch",
      "stockMovement",
      "stockMovement",
    ]);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("duplicate names in one import share one created product", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-inventory-import-"));
  const dataDir = path.join(directory, "pglite");
  const runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));

  try {
    const result = await runtime.runPromise(
      program.importInventory({
        categoryId: "general",
        lines: [importLine("Panadol"), importLine("  panadol  ")],
      }),
    );

    expect(result).toEqual({ createdProducts: 1, createdBatches: 2 });
    const storedProducts = await runtime.runPromise(program.listProducts);
    expect(storedProducts).toHaveLength(1);
    expect(storedProducts[0]?.name).toBe("Panadol");
    expect(storedProducts[0]?.batches).toHaveLength(2);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an invalid line rolls back every row and outbox change", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-inventory-import-"));
  const dataDir = path.join(directory, "pglite");
  const runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));

  try {
    await expect(
      runtime.runPromise(
        program.importInventory({
          categoryId: "general",
          lines: [
            importLine("First product"),
            { ...importLine("Invalid product"), packQuantity: -1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "PersistenceError",
      operation: "import inventory",
    });

    expect(await runtime.runPromise(program.listProducts)).toEqual([]);
    await runtime.dispose();
    const outbox = await readOutbox(dataDir);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload.map((change) => change.entity)).toEqual([
      "category",
      "category",
      "category",
    ]);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a repeated import reuses products by normalized name", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-inventory-import-"));
  const dataDir = path.join(directory, "pglite");
  const runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
  const input = { categoryId: "general", lines: [importLine("Brufen")] };

  try {
    await expect(runtime.runPromise(program.importInventory(input))).resolves.toEqual({
      createdProducts: 1,
      createdBatches: 1,
    });
    await expect(
      runtime.runPromise(
        program.importInventory({
          categoryId: "general",
          lines: [importLine("  brufen  ")],
        }),
      ),
    ).resolves.toEqual({ createdProducts: 0, createdBatches: 1 });

    const storedProducts = await runtime.runPromise(program.listProducts);
    expect(storedProducts).toHaveLength(1);
    expect(storedProducts[0]?.name).toBe("Brufen");
    expect(storedProducts[0]?.batches).toHaveLength(2);
    if (!storedProducts[0]) throw new Error("Imported product was not found");
    expect(await runtime.runPromise(program.listStockMovements(storedProducts[0].id))).toHaveLength(
      2,
    );
    await runtime.dispose();
    expect(await readOutbox(dataDir)).toHaveLength(3);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
