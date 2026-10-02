import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import { describe, expect, it, vi } from "vitest";

import type { InventoryHost } from "../src/host";
import { openInventoryWorkspace } from "../src/open";

const scope = { organizationId: "org-1", userId: "user-1" };

const identity = {
  organizationId: scope.organizationId,
  userId: scope.userId,
  replicaId: "replica-1",
};

describe("openInventoryWorkspace", () => {
  it("projects both rows of a new product with its first batch from one outbox command", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: identity.replicaId,
      openReplica: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    const category = await inventory.actions.createCategory({ name: "Tablets" });
    await inventory.categories.preload();
    await vi.waitFor(() => expect(inventory.categories.state.get(category.id)).toBeDefined());
    const created = await inventory.actions.createProductWithBatch({
      product: { name: "Panadol", categoryId: category.id, unitsPerPack: 10 },
      batch: { packQuantity: 2, unitQuantity: 3 },
    });
    const queued = await replica.query(
      `select operationId from command_outbox order by cast(clientSequence as integer)`,
      [],
    );
    expect(queued.map((row) => row["operationId"])).toEqual([
      category.operationId,
      created.product.operationId,
    ]);
    expect(await replica.query(`select id, name from products`, [])).toEqual([
      { id: created.product.id, name: "Panadol" },
    ]);
    expect(await replica.query(`select id, productId, packQuantity from batches`, [])).toEqual([
      { id: created.batch.id, productId: created.product.id, packQuantity: 2 },
    ]);
    await inventory.dispose();
  });

  it("stamps commands with the replica identity stored in the database, not the host candidate", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: "candidate-minted-after-restore",
      openReplica: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    const category = await inventory.actions.createCategory({ name: "Syrups" });
    expect(category.deviceId).toBe(identity.replicaId);
    const queued = await replica.query(`select envelopeJson from command_outbox`, []);
    expect(String(queued[0]?.["envelopeJson"])).toContain(`"replicaId":"${identity.replicaId}"`);
    await inventory.dispose();
  });
});
