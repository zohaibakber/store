import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import { DEFAULT_STOCK_POLICY } from "@store/services/insights";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { describe, expect, it, vi } from "vitest";

import { configureInventoryPreferences, stockPolicyAtom } from "../src/atoms";
import type { InventoryHost } from "../src/host";
import { openInventoryWorkspace } from "../src/open";

const scope = { organizationId: "org-1", userId: "user-1" };
const identity = { ...scope, replicaId: "replica-1" };

const readOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isSuccess(result) ? result.value : undefined;

describe("inventory insights atoms", () => {
  it("persists the planning policy through the configured key-value store", () => {
    const storage = new Map<string, string>();
    configureInventoryPreferences(
      KeyValueStore.layerStorage(() => ({
        length: storage.size,
        clear: () => storage.clear(),
        getItem: (key) => storage.get(key) ?? null,
        key: (index) => [...storage.keys()][index] ?? null,
        removeItem: (key) => void storage.delete(key),
        setItem: (key, value) => void storage.set(key, value),
      })),
    );
    const first = AtomRegistry.make();
    expect(first.get(stockPolicyAtom)).toEqual(DEFAULT_STOCK_POLICY);
    first.set(stockPolicyAtom, { ...DEFAULT_STOCK_POLICY, leadDays: 3 });
    first.dispose();

    const second = AtomRegistry.make();
    expect(second.get(stockPolicyAtom).leadDays).toBe(3);
    second.dispose();
    configureInventoryPreferences(KeyValueStore.layerMemory);
  });

  it("analyzes the replica and refreshes after a stock commit settles", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const readInsights = vi.spyOn(replica, "readInsights");
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
      lines: [{ productId: null, name: "Panadol", packQuantity: 0, unitQuantity: 0 }],
    });
    const registry = inventory.atoms.registry;
    const release = registry.mount(inventory.atoms.insights);

    await vi.waitFor(() => {
      const read = readOf(registry.get(inventory.atoms.insights));
      expect(read?.summary?.productCount).toBe(1);
      expect(read?.summary?.counts.inactive).toBe(1);
    });
    const reads = readInsights.mock.calls.length;

    await inventory.actions.createCategory({ name: "Syrups" });
    await vi.waitFor(() => expect(readInsights.mock.calls.length).toBeGreaterThan(reads), {
      timeout: 3_000,
    });
    expect(readInsights.mock.calls.length).toBe(reads + 1);

    release();
    await inventory.dispose();
  });
});
