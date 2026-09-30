import type { ReplicaHandle } from "@store/client-db";
import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { describe, expect, it, vi } from "vitest";

import { catalogOpenFailure, staleCatalogLease } from "../src/errors";
import type { InventoryHost } from "../src/host";
import { createCatalogLifetime } from "../src/lifetime";
import { inventoryScopeId, openInventoryWorkspace } from "../src/open";
import { inventoryState, openingCatalog } from "../src/opening";

const scope = { organizationId: "org-1", userId: "user-1" };

const identity = { ...scope, replicaId: "replica-1" };

const hostFor = (openReplica: () => Promise<ReplicaHandle>): InventoryHost => ({
  apiBaseUrl: "http://localhost",
  deviceId: identity.replicaId,
  openReplica,
});

const appCatalog = () =>
  createCatalogLifetime({ open: openInventoryWorkspace, databaseName: inventoryScopeId });

const noRetry = () => undefined;

describe("catalog opening", () => {
  it("claims an owned catalog while mounted and releases it when unmounted", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    let closed = false;
    const host = hostFor(async () => ({
      ...replica,
      close: () => {
        closed = true;
        return replica.close();
      },
    }));
    const catalog = appCatalog();
    const registry = AtomRegistry.make();
    const opening = openingCatalog(catalog, true, host, scope, undefined);

    const unmount = registry.mount(opening);
    const inventory = await Effect.runPromise(AtomRegistry.getResult(registry, opening));

    expect(catalog.lease()?.scope).toEqual(scope);
    expect(inventoryState(registry.get(opening), noRetry)).toEqual({
      _tag: "Ready",
      inventory,
      actions: inventory.actions,
    });
    unmount();
    await vi.waitFor(() => {
      expect(catalog.lease()).toBeNull();
      expect(closed).toBe(true);
    });
  });

  it("retries a failed open before reporting the catalog ready", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    let attempts = 0;
    const host = hostFor(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("replica busy");
      return replica;
    });
    const catalog = appCatalog();
    const registry = AtomRegistry.make();
    const opening = openingCatalog(catalog, true, host, scope, undefined);

    const unmount = registry.mount(opening);
    const inventory = await Effect.runPromise(AtomRegistry.getResult(registry, opening));

    expect(attempts).toBe(2);
    expect(inventoryState(registry.get(opening), noRetry)._tag).toBe("Ready");
    unmount();
    await inventory.dispose();
  });

  it("reports the open failure and reopens when the caller retries", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    let available = false;
    const host = hostFor(async () => {
      if (!available) throw new Error("replica missing");
      return replica;
    });
    const catalog = appCatalog();
    const registry = AtomRegistry.make();
    const opening = openingCatalog(catalog, false, host, scope, catalog.claim(scope));
    const retry = () => registry.refresh(opening);

    const unmount = registry.mount(opening);
    await Effect.runPromise(Effect.flip(AtomRegistry.getResult(registry, opening)));
    const failed = inventoryState(registry.get(opening), retry);
    expect(failed).toEqual({ _tag: "Error", error: "replica missing", retry });

    available = true;
    if (failed._tag === "Error") failed.retry();
    const inventory = await Effect.runPromise(
      AtomRegistry.getResult(registry, opening, { suspendOnWaiting: true }),
    );

    expect(inventoryState(registry.get(opening), retry)._tag).toBe("Ready");
    unmount();
    await inventory.dispose();
  }, 10_000);

  it("keeps a superseded lease opening and reports defects as unavailable storage", () => {
    expect(inventoryState(AsyncResult.fail(staleCatalogLease()), noRetry)).toEqual({
      _tag: "Opening",
    });
    expect(inventoryState(AsyncResult.initial(true), noRetry)).toEqual({ _tag: "Opening" });
    expect(inventoryState(AsyncResult.fail(catalogOpenFailure("locked")), noRetry)).toEqual({
      _tag: "Error",
      error: "Catalog storage is unavailable.",
      retry: noRetry,
    });
    expect(inventoryState(AsyncResult.failure(Cause.die("boom")), noRetry)).toEqual({
      _tag: "Error",
      error: "Catalog storage is unavailable.",
      retry: noRetry,
    });
  });
});
