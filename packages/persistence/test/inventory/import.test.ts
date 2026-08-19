import type { ImportInventoryLine, ProductId } from "@store/contracts";
import { decodeCategoryId } from "@store/contracts";
import { expect, test } from "vitest";

import { readOutbox, store, withTestStore } from "../lib/store";

const generalCategoryId = decodeCategoryId("general");

const importLine = (name: string, productId: ProductId | null = null): ImportInventoryLine => ({
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
  await withTestStore(async ({ dataDir, runtime: initialRuntime, makeRuntime }) => {
    let runtime = initialRuntime;
    const existing = await runtime.runPromise(
      store((store) =>
        store.createProduct({
          name: "Existing product",
          categoryId: generalCategoryId,
          aisle: null,
          composition: null,
          strength: null,
          unitsPerPack: 6,
          packPrice: null,
          unitPrice: null,
        }),
      ),
    );
    await runtime.dispose();
    const before = await readOutbox(dataDir);
    runtime = makeRuntime();

    await expect(
      runtime.runPromise(
        store((store) =>
          store.importInventory({
            categoryId: generalCategoryId,
            lines: [importLine("Aspirin"), importLine("Existing product", existing.id)],
          }),
        ),
      ),
    ).resolves.toEqual({ createdProducts: 1, createdBatches: 2 });

    const storedProducts = await runtime.runPromise(store((store) => store.listProducts));
    const aspirin = storedProducts.find((product) => product.name === "Aspirin");
    const reloadedExisting = storedProducts.find((product) => product.id === existing.id);
    expect(aspirin?.batches).toHaveLength(1);
    expect(reloadedExisting?.batches).toHaveLength(1);
    if (!aspirin) throw new Error("Imported product was not found");
    expect(
      await runtime.runPromise(store((store) => store.listStockMovements(aspirin.id))),
    ).toHaveLength(1);
    expect(
      await runtime.runPromise(store((store) => store.listStockMovements(existing.id))),
    ).toHaveLength(1);

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
  });
}, 30_000);

test("duplicate names in one import share one created product", async () => {
  await withTestStore(async ({ runtime }) => {
    const result = await runtime.runPromise(
      store((store) =>
        store.importInventory({
          categoryId: generalCategoryId,
          lines: [importLine("Panadol"), importLine("  panadol  ")],
        }),
      ),
    );

    expect(result).toEqual({ createdProducts: 1, createdBatches: 2 });
    const storedProducts = await runtime.runPromise(store((store) => store.listProducts));
    expect(storedProducts).toHaveLength(1);
    expect(storedProducts[0]?.name).toBe("Panadol");
    expect(storedProducts[0]?.batches).toHaveLength(2);
  });
});

test("large imports are committed locally once and queued in bounded sync operations", async () => {
  const lines = Array.from({ length: 100 }, (_, index) =>
    importLine(`Imported product ${index + 1}`),
  );

  await withTestStore(async ({ dataDir, runtime }) => {
    await expect(
      runtime.runPromise(
        store((store) => store.importInventory({ categoryId: generalCategoryId, lines })),
      ),
    ).resolves.toEqual({ createdProducts: 100, createdBatches: 100 });

    expect(await runtime.runPromise(store((store) => store.listProducts))).toHaveLength(100);
    await runtime.dispose();

    const outbox = await readOutbox(dataDir);
    const importOperations = outbox.slice(1);
    expect(importOperations.map((operation) => operation.payload.length)).toEqual([198, 102]);
    expect(importOperations.every((operation) => operation.payload.length <= 200)).toBe(true);
  });
}, 30_000);

test("an invalid line rolls back every row and outbox change", async () => {
  await withTestStore(async ({ dataDir, runtime }) => {
    await expect(
      runtime.runPromise(
        store((store) =>
          store.importInventory({
            categoryId: generalCategoryId,
            lines: [
              importLine("First product"),
              { ...importLine("Invalid product"), packQuantity: -1 },
            ],
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "PersistenceError",
      operation: "import inventory",
    });

    expect(await runtime.runPromise(store((store) => store.listProducts))).toEqual([]);
    await runtime.dispose();
    const outbox = await readOutbox(dataDir);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload.map((change) => change.entity)).toEqual(["category"]);
  });
});

test("a repeated import reuses products by normalized name", async () => {
  const input = { categoryId: generalCategoryId, lines: [importLine("Brufen")] };

  await withTestStore(async ({ dataDir, runtime }) => {
    await expect(
      runtime.runPromise(store((store) => store.importInventory(input))),
    ).resolves.toEqual({
      createdProducts: 1,
      createdBatches: 1,
    });
    await expect(
      runtime.runPromise(
        store((store) =>
          store.importInventory({
            categoryId: generalCategoryId,
            lines: [importLine("  brufen  ")],
          }),
        ),
      ),
    ).resolves.toEqual({ createdProducts: 0, createdBatches: 1 });

    const storedProducts = await runtime.runPromise(store((store) => store.listProducts));
    expect(storedProducts).toHaveLength(1);
    expect(storedProducts[0]?.name).toBe("Brufen");
    expect(storedProducts[0]?.batches).toHaveLength(2);
    if (!storedProducts[0]) throw new Error("Imported product was not found");
    expect(
      await runtime.runPromise(store((store) => store.listStockMovements(storedProducts[0].id))),
    ).toHaveLength(2);
    await runtime.dispose();
    expect(await readOutbox(dataDir)).toHaveLength(3);
  });
});
