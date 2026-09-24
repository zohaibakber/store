import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import type { ImportInventoryInput } from "@store/contracts";
import { createLiveQueryCollection } from "@tanstack/react-db";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { describe, expect, it, vi } from "vitest";

import type { InventoryHost } from "../src/host";
import { openInventoryWorkspace } from "../src/open";
import { batchesForProducts } from "../src/queries";
import { searchCatalogProducts } from "../src/search";
import type { Inventory } from "../src/types";

const openWithCategory = async (host: InventoryHost) => {
  const inventory = await openInventoryWorkspace(host, scope);
  const category = await inventory.actions.createCategory({ name: "Tablets" });
  await inventory.categories.preload();
  await vi.waitFor(() => expect(inventory.categories.state.get(category.id)).toBeDefined());
  return { inventory, category };
};

const importNames = (
  inventory: Inventory,
  categoryId: ImportInventoryInput["categoryId"],
  names: ReadonlyArray<string>,
) =>
  inventory.actions.importInventory({
    categoryId,
    lines: names.map((name) => ({ productId: null, name, packQuantity: 1, unitQuantity: 0 })),
  });

const currentValue = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isSuccess(result) ? result.value : undefined;

const scope = { organizationId: "org-1", userId: "user-1" };

const identity = {
  organizationId: scope.organizationId,
  userId: scope.userId,
  replicaId: "replica-1",
};

describe("openInventoryWorkspace", () => {
  it("opens the workspace replica", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: identity.replicaId,
      openReplica: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    expect(inventory.atoms.registry.get(inventory.atoms.syncStatus)).toEqual({ _tag: "caughtUp" });
    const category = await inventory.actions.createCategory({ name: "Tea" });
    expect(category.name).toBe("Tea");
    expect(category.rowVersion).toBe(1);
    await vi.waitFor(() =>
      expect(inventory.atoms.registry.get(inventory.atoms.syncStatus)).toEqual({
        _tag: "savedLocally",
      }),
    );
    const queued = await replica.query(
      `select operationId, clientSequence, envelopeJson from command_outbox`,
      [],
    );
    expect(queued).toHaveLength(1);
    await inventory.dispose();
  });

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

  it("loads batches for more matched products than one indexed lookup holds", async () => {
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
    await inventory.actions.importInventory({
      categoryId: category.id,
      lines: Array.from({ length: 40 }, (_, index) => ({
        productId: null,
        name: `Line ${index}`,
        packQuantity: 1,
        unitQuantity: 0,
      })),
    });
    const products = await replica.query(`select id from products`, []);
    const productIds = products.map((row) => String(row["id"]));
    expect(productIds).toHaveLength(40);
    const batches = createLiveQueryCollection({
      query: (builder) => batchesForProducts(builder, inventory, productIds)!,
    });
    const loaded = await batches.toArrayWhenReady();
    expect(new Set(loaded.map((batch) => batch.productId))).toEqual(new Set(productIds));
    await batches.cleanup();
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

  it("searches the whole catalog through bounded indexed reads", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: identity.replicaId,
      openReplica: async () => replica,
    };
    const { inventory, category } = await openWithCategory(host);
    await importNames(
      inventory,
      category.id,
      Array.from({ length: 520 }, (_, index) => `Item ${String(index).padStart(3, "0")}`),
    );
    await importNames(inventory, category.id, ["Zyrtec", "Extra Zyrtec Syrup"]);

    const names = async (query: string, limit: number) =>
      (await Effect.runPromise(searchCatalogProducts(replica, query, limit))).map(
        (product) => product.name,
      );
    expect(await names("zyr", 10)).toEqual(["Zyrtec", "Extra Zyrtec Syrup"]);
    expect(await names("item 51", 3)).toEqual(["Item 510", "Item 511", "Item 512"]);
    expect(await names("", 2)).toEqual(["Extra Zyrtec Syrup", "Item 000"]);
    expect(await names("item", 1_000)).toHaveLength(200);
    await inventory.dispose();
  });

  it("refreshes product search and pending row marks when local commits land", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: identity.replicaId,
      openReplica: async () => replica,
    };
    const { inventory, category } = await openWithCategory(host);
    const { registry } = inventory.atoms;
    const search = inventory.atoms.productSearch(10)("pan");
    const pendingProducts = inventory.atoms.pendingRowIds("product");
    const unmountSearch = registry.mount(search);
    const unmountPending = registry.mount(pendingProducts);
    await Effect.runPromise(AtomRegistry.getResult(registry, search));
    expect(currentValue(registry.get(search))).toEqual([]);

    const created = await inventory.actions.createProductWithBatch({
      product: { name: "Panadol", categoryId: category.id, unitsPerPack: 10 },
      batch: { packQuantity: 2, unitQuantity: 0 },
    });

    await vi.waitFor(() => {
      expect(currentValue(registry.get(search))?.map((product) => product.id)).toEqual([
        created.product.id,
      ]);
      expect(currentValue(registry.get(pendingProducts))).toEqual(new Set([created.product.id]));
    });
    expect(registry.get(inventory.atoms.syncActivity)).toMatchObject({
      pendingCount: 2,
      rejectedCount: 0,
      rejected: [],
      lastCaughtUpAt: null,
    });
    unmountSearch();
    unmountPending();
    await inventory.dispose();
  });

  it("does not open a workspace when the replica opener fails", async () => {
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: identity.replicaId,
      openReplica: async () => {
        throw new Error("replica missing");
      },
    };
    await expect(openInventoryWorkspace(host, scope)).rejects.toThrow("replica missing");
  });

  it("reports saved-locally from the outbox without waiting for a remote connection", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    await replica.withWrite(
      (handle) =>
        Effect.asVoid(
          handle.sql.unsafe(
            `insert into command_outbox (
              operationId, status, envelopeJson, clientSequence, createdAt, attempts, outcomeUncertain
            ) values ('op-1', 'pending', '{}', '1', 1, 0, 0)`,
          ),
        ),
      [],
      [],
    );
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: identity.replicaId,
      openReplica: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    expect(inventory.atoms.registry.get(inventory.atoms.syncStatus)).toEqual({
      _tag: "savedLocally",
    });
    await inventory.dispose();
  });
});
