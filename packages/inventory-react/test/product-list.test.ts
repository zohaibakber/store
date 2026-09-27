import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { describe, expect, it, vi } from "vitest";

import type { InventoryHost } from "../src/host";
import { openInventoryWorkspace } from "../src/open";

const scope = { organizationId: "org-1", userId: "user-1" };

const successOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isSuccess(result) ? result.value : undefined;

describe("product list reads", () => {
  it("pages, counts, and facets the whole catalog in the replica", async () => {
    const replica = await openNodeReplicaSqlite({ ...scope, replicaId: "replica-1" });
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: "replica-1",
      openReplica: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    const tablets = await inventory.actions.createCategory({ name: "Tablets" });
    await inventory.categories.preload();
    await vi.waitFor(() => expect(inventory.categories.state.get(tablets.id)).toBeDefined());
    await inventory.actions.importInventory({
      categoryId: tablets.id,
      lines: Array.from({ length: 620 }, (_, index) => ({
        productId: null,
        name: `${index % 2 === 0 ? "alpha" : "Beta"} ${String(index).padStart(4, "0")}`,
        packQuantity: 1,
        unitQuantity: 0,
      })),
    });
    const registry = inventory.atoms.registry;
    const request = {
      filters: {},
      sort: { column: "name", direction: "asc" },
      pageIndex: 6,
      pageSize: 50,
    } as const;
    const page = inventory.atoms.productPage(request);
    const deep = inventory.atoms.productPage({ ...request, pageIndex: 12 });
    const count = inventory.atoms.productCount({});
    const search = inventory.atoms.productCount({ search: "beta" });
    const releases = [
      registry.mount(page),
      registry.mount(deep),
      registry.mount(count),
      registry.mount(search),
    ];

    await vi.waitFor(() => {
      const rows = successOf(registry.get(page));
      expect(rows?.map((row) => row.name)).toHaveLength(50);
      expect(rows?.[0]?.name).toBe("alpha 0600");
      expect(rows?.[10]?.name).toBe("Beta 0001");
      expect(successOf(registry.get(deep))?.[0]?.name).toBe("Beta 0581");
      expect(successOf(registry.get(count))).toBe(620);
      expect(successOf(registry.get(search))).toBe(310);
    });
    expect(inventory.atoms.productPage({ ...request })).toBe(page);

    for (const release of releases) release();
    await inventory.dispose();
  });
});
