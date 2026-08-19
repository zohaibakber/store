import { decodeBatchId } from "@store/contracts";
import { expect, test } from "vitest";

import { readOutbox, store, withTestStore } from "../lib/store";

const productInput = {
  name: "Panadol",
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  packPrice: 1500,
  unitPrice: 200,
};

test("updateBatch corrects the batch number and expiry without touching stock", async () => {
  await withTestStore(async ({ runtime }) => {
    const product = await runtime.runPromise(store((store) => store.createProduct(productInput)));
    const created = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "BN-typo",
          expiresAt: null,
          packQuantity: 2,
          unitQuantity: 3,
        }),
      ),
    );

    const expiresAt = Date.UTC(2027, 0, 31);
    const updated = await runtime.runPromise(
      store((store) => store.updateBatch({ id: created.id, batchNumber: "BN-1234", expiresAt })),
    );

    expect(updated).toMatchObject({
      id: created.id,
      productId: product.id,
      batchNumber: "BN-1234",
      expiresAt,
      packQuantity: 2,
      unitQuantity: 3,
      createdAt: created.createdAt,
    });
    expect(updated.rowVersion).toBe(created.rowVersion + 1);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    // The edit is metadata only: no stock movement beyond the initial receipt.
    const movements = await runtime.runPromise(
      store((store) => store.listStockMovements(product.id)),
    );
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "stock_in", packDelta: 2, unitDelta: 3 });

    const reloaded = await runtime.runPromise(store((store) => store.getProduct(product.id)));
    expect(reloaded.batches).toEqual([updated]);
  });
});

test("updateBatch clears the batch number when it is blank", async () => {
  await withTestStore(async ({ runtime }) => {
    const product = await runtime.runPromise(store((store) => store.createProduct(productInput)));
    const created = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "BN-1234",
          expiresAt: Date.UTC(2027, 0, 31),
          packQuantity: 1,
          unitQuantity: 0,
        }),
      ),
    );

    const updated = await runtime.runPromise(
      store((store) => store.updateBatch({ id: created.id, batchNumber: "   ", expiresAt: null })),
    );

    expect(updated.batchNumber).toBeNull();
    expect(updated.expiresAt).toBeNull();
  });
});

test("updateBatch queues one batch upsert for sync", async () => {
  await withTestStore(async ({ dataDir, runtime }) => {
    const product = await runtime.runPromise(store((store) => store.createProduct(productInput)));
    const created = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: null,
          expiresAt: null,
          packQuantity: 1,
          unitQuantity: 0,
        }),
      ),
    );
    await runtime.runPromise(
      store((store) => store.updateBatch({ id: created.id, batchNumber: "BN-1", expiresAt: null })),
    );
    await runtime.dispose();

    const queued = await readOutbox(dataDir);
    expect(queued.at(-1)?.payload).toEqual([
      expect.objectContaining({ entity: "batch", action: "upsert", entityId: created.id }),
    ]);
  });
});

test("updateBatch records an adjustment when the count is corrected", async () => {
  await withTestStore(async ({ dataDir, runtime }) => {
    const product = await runtime.runPromise(store((store) => store.createProduct(productInput)));
    const created = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "BN-1",
          expiresAt: null,
          packQuantity: 2,
          unitQuantity: 3,
        }),
      ),
    );

    const updated = await runtime.runPromise(
      store((store) =>
        store.updateBatch({
          id: created.id,
          batchNumber: "BN-1",
          expiresAt: null,
          packQuantity: 5,
          unitQuantity: 0,
        }),
      ),
    );

    expect(updated).toMatchObject({ packQuantity: 5, unitQuantity: 0 });

    const movements = await runtime.runPromise(
      store((store) => store.listStockMovements(product.id)),
    );
    expect(movements).toHaveLength(2);
    // Newest first: the correction, then the receipt it corrects.
    expect(movements[0]).toMatchObject({
      type: "adjustment",
      batchId: created.id,
      packDelta: 3,
      unitDelta: -3,
    });

    // The correction syncs as both the new count and the movement explaining it.
    await runtime.dispose();
    const queued = await readOutbox(dataDir);
    expect(queued.at(-1)?.payload).toEqual([
      expect.objectContaining({ entity: "batch", action: "upsert", entityId: created.id }),
      expect.objectContaining({ entity: "stockMovement", action: "upsert" }),
    ]);
  });
});

test("updateBatch rejects a negative quantity", async () => {
  await withTestStore(async ({ runtime }) => {
    const product = await runtime.runPromise(store((store) => store.createProduct(productInput)));
    const created = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: null,
          expiresAt: null,
          packQuantity: 1,
          unitQuantity: 0,
        }),
      ),
    );

    await expect(
      runtime.runPromise(
        store((store) =>
          store.updateBatch({
            id: created.id,
            batchNumber: null,
            expiresAt: null,
            unitQuantity: -1,
          }),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "PersistenceError", operation: "update batch" });
  });
});

test("updateBatch fails with BatchNotFoundError for an unknown batch", async () => {
  await withTestStore(async ({ runtime }) => {
    await expect(
      runtime.runPromise(
        store((store) =>
          store.updateBatch({ id: decodeBatchId("missing"), batchNumber: null, expiresAt: null }),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "BatchNotFoundError", id: "missing" });
  });
});

test("updateBatch rejects an invalid expiry timestamp", async () => {
  await withTestStore(async ({ runtime }) => {
    const product = await runtime.runPromise(store((store) => store.createProduct(productInput)));
    const created = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: null,
          expiresAt: null,
          packQuantity: 1,
          unitQuantity: 0,
        }),
      ),
    );

    await expect(
      runtime.runPromise(
        store((store) =>
          store.updateBatch({ id: created.id, batchNumber: null, expiresAt: Number.NaN }),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "PersistenceError", operation: "update batch" });
  });
});
