import { describe, expect, it } from "vitest";

import type { InventoryHost } from "../src/lib/inventory-host";
import { createCatalogLifetime, StaleCatalogLease } from "../src/lib/inventory/lifetime";

const host: InventoryHost = {
  apiBaseUrl: "http://localhost",
  authenticatedFetch: globalThis.fetch,
  deviceId: "device",
  openPowerSyncDatabase: async () => {
    throw new Error("unused");
  },
};

const scope = { organizationId: "o1", userId: "u1" };

describe("catalog lifetime", () => {
  it("does not await dispose on release", () => {
    const hanging = new Promise<void>(() => undefined);
    const catalog = createCatalogLifetime({
      open: async () => ({ dispose: () => hanging }),
      databaseName: () => "org",
      sameFileWaitMs: 20,
    });
    catalog.claim(scope);
    const started = Date.now();
    catalog.release();
    expect(Date.now() - started).toBeLessThan(50);
    expect(catalog.lease()).toBeNull();
  });

  it("ignores a hung previous dispose when opening the next generation", async () => {
    let opens = 0;
    const hanging = new Promise<void>(() => undefined);
    const catalog = createCatalogLifetime({
      open: async () => {
        opens += 1;
        return {
          dispose: () => hanging,
        };
      },
      databaseName: () => "org",
      sameFileWaitMs: 20,
    });

    const first = catalog.claim(scope);
    await catalog.open(first, host);
    catalog.release();
    const second = catalog.claim(scope);
    await catalog.open(second, host);
    expect(opens).toBe(2);
    expect(catalog.lease()?.generation).toBe(second.generation);
  });

  it("fails open for a stale lease after a newer claim", async () => {
    const catalog = createCatalogLifetime({
      open: async () => ({ dispose: async () => undefined }),
      databaseName: () => "org",
    });
    const stale = catalog.claim(scope);
    catalog.claim(scope);
    await expect(catalog.open(stale, host)).rejects.toBeInstanceOf(StaleCatalogLease);
  });
});
