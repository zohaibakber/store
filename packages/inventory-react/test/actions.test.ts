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
    readInsights: async () => {
      throw new Error("unused");
    },
    summarizeSubset: async () => {
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
  const atoms = createWorkspaceAtoms();
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
