import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer } from "./index";
import { migrationsFolder, store } from "./test-support";

test("sealed packs and loose units remain distinct through sales", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ dataDir: path.join(directory, "pglite"), migrationsFolder }),
  );

  try {
    const product = await runtime.runPromise(
      store((store) =>
        store.createProduct({
          name: "Tablet box",
          aisle: "B2",
          composition: null,
          strength: null,
          unitsPerPack: 30,
          packPrice: 3000,
          unitPrice: 110,
        }),
      ),
    );
    const batch = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "BOX-1",
          expiresAt: null,
          packQuantity: 10,
          unitQuantity: 6,
        }),
      ),
    );

    await runtime.runPromise(
      store((store) =>
        store.createInvoice({
          customerName: null,
          items: [
            {
              productId: product.id,
              batchId: batch.id,
              quantity: 7,
              quantityType: "unit",
              salePrice: 110,
            },
          ],
        }),
      ),
    );
    let reloaded = await runtime.runPromise(store((store) => store.getProduct(product.id)));
    expect(reloaded.batches[0]).toMatchObject({ packQuantity: 9, unitQuantity: 29 });

    await runtime.runPromise(
      store((store) =>
        store.createInvoice({
          customerName: null,
          items: [
            {
              productId: product.id,
              batchId: batch.id,
              quantity: 2,
              quantityType: "pack",
              salePrice: 3000,
            },
          ],
        }),
      ),
    );
    reloaded = await runtime.runPromise(store((store) => store.getProduct(product.id)));
    expect(reloaded.batches[0]).toMatchObject({ packQuantity: 7, unitQuantity: 29 });

    const movements = await runtime.runPromise(
      store((store) => store.listStockMovements(product.id)),
    );
    expect(movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "open_pack", packDelta: -1, unitDelta: 30 }),
        expect.objectContaining({ type: "sale", packDelta: 0, unitDelta: -7 }),
        expect.objectContaining({ type: "sale", packDelta: -2, unitDelta: 0 }),
      ]),
    );
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
