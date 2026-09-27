import type {
  BatchRow,
  CategoryRow,
  InvoiceRow,
  ProductRow,
  ReplicaHandle,
} from "@store/client-db";
import { syncProtocolError, type SyncCommandEnvelope } from "@store/contracts";
import { decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { makeInventoryActions } from "../src/actions";
import { createWorkspaceAtoms } from "../src/atoms";
import type { InventoryActor } from "../src/types";

const actor: InventoryActor = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  deviceId: "device-1",
};

const metadata = {
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 3,
  createdAt: 1,
  updatedAt: 1,
};

const categoryId = decodeCategoryId("22222222-2222-4222-8222-222222222222");
const productId = decodeProductId("33333333-3333-4333-8333-333333333333");

const category: CategoryRow = { id: categoryId, name: "Tea", tracksPacks: true, ...metadata };

const product: ProductRow = {
  id: productId,
  name: "Green",
  categoryId,
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  purchasePrice: null,
  retailPrice: null,
  unitPrice: null,
  visible: true,
  ...metadata,
};

const collectionOf = <Row extends { readonly id: string }>(rows: ReadonlyArray<Row>) => {
  const map = new Map(rows.map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => map.get(id),
      values: () => map.values(),
    },
  };
};

const harness = (rows?: {
  readonly categories?: ReadonlyArray<CategoryRow>;
  readonly products?: ReadonlyArray<ProductRow>;
  readonly batches?: ReadonlyArray<BatchRow>;
  readonly rejectEnqueue?: Error;
}) => {
  const enqueued: Array<SyncCommandEnvelope> = [];
  let nextClientSequence = 1n;
  const replica: ReplicaHandle = {
    workspaceToken: "workspace",
    engine: "sqlite" as const,
    stamp: async () => ({ workspaceToken: "workspace", generationId: "1", localCommitVersion: 1 }),
    readSubset: async () => {
      throw new Error("unused");
    },
    readOutboxStatuses: async () => [],
    readCommandAllocation: async () => ({
      epoch: "1",
      nextClientSequence: String(nextClientSequence),
    }),
    enqueueLocal: async (envelope: SyncCommandEnvelope) => {
      if (rows?.rejectEnqueue) throw rows.rejectEnqueue;
      enqueued.push(envelope);
      nextClientSequence += 1n;
      return { changed: true, status: "pending" };
    },
    subscribe: () => () => undefined,
    publish: () => undefined,
    close: () => undefined,
  };
  const atoms = createWorkspaceAtoms(undefined, async () => {
    throw new Error("unused");
  });
  const tables = {
    batches: collectionOf(rows?.batches ?? []),
    categories: collectionOf(rows?.categories ?? [category]),
    products: collectionOf(rows?.products ?? [product]),
    invoices: collectionOf<InvoiceRow>([]),
  };
  const actions = makeInventoryActions(tables, actor, replica, () => undefined, atoms);
  return { actions, atoms, enqueued };
};

const catalogWrites = (envelope: SyncCommandEnvelope) => {
  if (envelope.command._tag !== "catalogWrite") throw new Error("expected a catalog command");
  return envelope.command.payload.writes;
};

describe("inventory catalog actions", () => {
  it("enqueues a category insert with a null expected row version", async () => {
    const { actions, enqueued } = harness({ categories: [] });
    const row = await actions.createCategory({ name: "Coffee" });
    expect(row.rowVersion).toBe(1);
    expect(row.organizationId).toBe(actor.organizationId);
    expect(enqueued).toHaveLength(1);
    expect(catalogWrites(enqueued[0]!)).toEqual([
      {
        entity: "category",
        action: "upsert",
        id: row.id,
        expectedRowVersion: null,
        row: { name: "Coffee", tracksPacks: true },
      },
    ]);
  });

  it("guards a product update with the current row version", async () => {
    const { actions, enqueued } = harness();
    const row = await actions.updateProduct({
      id: productId,
      name: "Green Label",
      categoryId,
      unitsPerPack: 10,
    });
    expect(row.rowVersion).toBe(4);
    expect(catalogWrites(enqueued[0]!)[0]).toMatchObject({
      entity: "product",
      action: "upsert",
      expectedRowVersion: 3,
      row: { name: "Green Label", unitsPerPack: 10 },
    });
  });

  it("carries a movement id on batch upserts", async () => {
    const { actions, enqueued } = harness();
    await actions.createBatch({ productId, packQuantity: 2, unitQuantity: 0 });
    const write = catalogWrites(enqueued[0]!)[0];
    expect(write).toMatchObject({ entity: "batch", action: "upsert", note: null });
    expect(write && "movementId" in write ? write.movementId : "").toMatch(/[0-9a-f-]{36}/u);
  });

  it("creates a product and its first batch in one atomic catalog command", async () => {
    const { actions, atoms, enqueued } = harness();
    const created = await actions.createProductWithBatch({
      product: { name: " Panadol Extra ", categoryId, unitsPerPack: 12 },
      batch: {
        batchNumber: " B-7 ",
        expiresAt: 1_900_000_000_000,
        packQuantity: 3,
        unitQuantity: 4,
      },
    });
    expect(created.product).toMatchObject({ name: "Panadol Extra", categoryId, unitsPerPack: 12 });
    expect(created.batch).toMatchObject({
      productId: created.product.id,
      batchNumber: "B-7",
      packQuantity: 3,
      unitQuantity: 4,
    });
    expect(created.product.operationId).toBe(created.batch.operationId);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.operationId).toBe(created.product.operationId);
    expect(catalogWrites(enqueued[0]!)).toMatchObject([
      {
        entity: "product",
        action: "upsert",
        id: created.product.id,
        expectedRowVersion: null,
        row: { name: "Panadol Extra", unitsPerPack: 12 },
      },
      {
        entity: "batch",
        action: "upsert",
        id: created.batch.id,
        expectedRowVersion: null,
        row: { productId: created.product.id, packQuantity: 3, unitQuantity: 4 },
      },
    ]);
    expect(atoms.registry.get(atoms.commandExecution)).toMatchObject({ _tag: "pending" });
  });

  it("enqueues nothing when the batch half of a new product is invalid", async () => {
    const { actions, atoms, enqueued } = harness();
    await expect(
      actions.createProductWithBatch({
        product: { name: "Panadol", categoryId },
        batch: { packQuantity: -1, unitQuantity: 0 },
      }),
    ).rejects.toThrow("Pack quantity must be a non-negative whole number.");
    expect(enqueued).toHaveLength(0);
    expect(atoms.registry.get(atoms.commandExecution)).toMatchObject({ _tag: "failed" });
  });

  it("receives a batch for an existing product as a single batch upsert", async () => {
    const { actions, enqueued } = harness();
    const batch = await actions.receiveBatch({ productId, packQuantity: 5, unitQuantity: 0 });
    expect(batch.productId).toBe(productId);
    expect(enqueued).toHaveLength(1);
    expect(catalogWrites(enqueued[0]!)).toMatchObject([
      { entity: "batch", action: "upsert", expectedRowVersion: null, row: { productId } },
    ]);
  });

  it("refuses to enqueue a delete that breaks a catalog rule", async () => {
    const { actions, atoms, enqueued } = harness();
    await expect(actions.deleteCategory(categoryId)).rejects.toThrow(
      "Move products to another category before deleting this category.",
    );
    expect(enqueued).toHaveLength(0);
    expect(atoms.registry.get(atoms.commandExecution)).toMatchObject({ _tag: "failed" });
  });

  it("surfaces an enqueue rejection through the command execution atom", async () => {
    const { actions, atoms } = harness({
      categories: [],
      rejectEnqueue: syncProtocolError("INSUFFICIENT_STOCK", "Not enough stock on hand."),
    });
    await expect(actions.createCategory({ name: "Coffee" })).rejects.toThrow(
      "Not enough stock on hand.",
    );
    expect(atoms.registry.get(atoms.commandExecution)).toMatchObject({
      _tag: "failed",
      message: "Not enough stock on hand.",
    });
  });

  it("chunks a large import into commands with consecutive client sequences", async () => {
    const { actions, enqueued } = harness();
    const lines = Array.from({ length: 501 }, (_, index) => ({
      productId: null,
      name: `Line ${index}`,
      packQuantity: 1,
      unitQuantity: 0,
    }));
    const result = await actions.importInventory({ categoryId, lines });
    expect(result.createdProducts).toBe(501);
    expect(result.createdBatches).toBe(501);
    expect(enqueued).toHaveLength(2);
    expect(catalogWrites(enqueued[0]!)).toHaveLength(1000);
    expect(catalogWrites(enqueued[1]!)).toHaveLength(2);
    expect(enqueued.map((envelope) => envelope.clientSequence)).toEqual(["1", "2"]);
    expect(new Set(enqueued.map((envelope) => envelope.operationId)).size).toBe(2);
  });
});
