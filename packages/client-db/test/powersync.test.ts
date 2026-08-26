import { UpdateType } from "@powersync/common";
import { describe, expect, it, vi } from "vitest";

import { inventoryReplicaDatabaseName } from "../src/inventory";
import { InventoryFailure } from "../src/inventory-failure";
import {
  decodePowerSyncCatalogCrudEntry,
  disconnectAndClearInventoryPowerSync,
  uploadInventoryCrudTransaction,
  uploadInventoryData,
  waitForInventoryFirstSync,
  waitForInventoryUploadDrain,
} from "../src/powersync";

const category = {
  id: "category-1",
  name: "Pain relief",
  tracksPacks: 1,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "operation-1",
  rowVersion: 1,
  createdAt: 100,
  updatedAt: 100,
  deletedAt: null,
};

describe("PowerSync catalog upload snapshots", () => {
  it("reconstructs each offline patch from its own previous values", () => {
    const first = decodePowerSyncCatalogCrudEntry("categories", {
      id: category.id,
      op: UpdateType.PATCH,
      previousValues: category,
      opData: {
        name: "Pain and fever",
        operationId: "operation-2",
        rowVersion: 2,
        updatedAt: 200,
      },
    });
    const second = decodePowerSyncCatalogCrudEntry("categories", {
      id: category.id,
      op: UpdateType.PATCH,
      previousValues: { ...category, ...first, tracksPacks: 1 },
      opData: {
        name: "Pain, fever, and cold",
        operationId: "operation-3",
        rowVersion: 3,
        updatedAt: 300,
      },
    });

    expect(first).toMatchObject({ name: "Pain and fever", rowVersion: 2 });
    expect(second).toMatchObject({ name: "Pain, fever, and cold", rowVersion: 3 });
  });

  it("supplies null SQLite defaults omitted from an insert", () => {
    const { deletedAt: omitted, ...insert } = category;
    expect(omitted).toBeNull();
    expect(
      decodePowerSyncCatalogCrudEntry("categories", {
        id: category.id,
        op: UpdateType.PUT,
        opData: insert,
      }),
    ).toMatchObject({ id: category.id, deletedAt: null, tracksPacks: true });
  });

  it("keeps the row mutation id on reconstructed catalog writes", () => {
    expect(
      decodePowerSyncCatalogCrudEntry("categories", {
        id: category.id,
        op: UpdateType.PUT,
        opData: category,
      }).operationId,
    ).toBe("operation-1");
    expect(
      decodePowerSyncCatalogCrudEntry("categories", {
        id: "category-2",
        op: UpdateType.PUT,
        opData: { ...category, id: "category-2", operationId: "operation-2" },
      }).operationId,
    ).toBe("operation-2");
  });
});

describe("PowerSync catalog upload failures", () => {
  const conflictBody = JSON.stringify({
    error: {
      code: "ENTITY_CONFLICT",
      message: "The entity changed before this mutation was saved.",
    },
  });

  it("skips ENTITY_CONFLICT and still uploads the rest of the batch", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(conflictBody, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ txid: 1 }), { status: 200 }));
    const complete = vi.fn(async () => undefined);

    await uploadInventoryCrudTransaction(
      { apiBaseUrl: "https://api.example/api", authenticatedFetch },
      {
        crud: [
          { id: category.id, table: "categories", op: UpdateType.PUT, opData: category },
          {
            id: "category-2",
            table: "categories",
            op: UpdateType.PUT,
            opData: { ...category, id: "category-2", operationId: "operation-2" },
          },
        ],
        complete,
      },
    );

    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("leaves the queue in place when the server is down", async () => {
    const authenticatedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "INTERNAL_SERVER_ERROR", message: "down" } }), {
        status: 503,
      }),
    );
    const complete = vi.fn(async () => undefined);

    await expect(
      uploadInventoryCrudTransaction(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch },
        {
          crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
          complete,
        },
      ),
    ).rejects.toThrow(InventoryFailure);
    expect(complete).not.toHaveBeenCalled();
  });

  it("leaves the queue in place when the network fails", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const complete = vi.fn(async () => undefined);

    await expect(
      uploadInventoryCrudTransaction(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch },
        {
          crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
          complete,
        },
      ),
    ).rejects.toMatchObject({ name: "InventoryFailure", reason: { _tag: "transport" } });
    expect(complete).not.toHaveBeenCalled();
  });

  it("retries Electron IPC network failures instead of dropping the queue", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error("Error invoking remote method 'inventory:http': Failed to fetch"),
      );
    const complete = vi.fn(async () => undefined);

    await expect(
      uploadInventoryCrudTransaction(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch },
        {
          crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
          complete,
        },
      ),
    ).rejects.toMatchObject({ name: "InventoryFailure", reason: { _tag: "transport" } });
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not complete a 401 after refresh is exhausted", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }),
          { status: 401 },
        ),
      );
    const complete = vi.fn(async () => undefined);

    await expect(
      uploadInventoryCrudTransaction(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch },
        {
          crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
          complete,
        },
      ),
    ).rejects.toMatchObject({
      name: "InventoryFailure",
      message: "Sign in required.",
      reason: { _tag: "unauthenticated" },
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not complete other permanent 4xx failures", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "ORGANIZATION_MISMATCH", message: "Wrong org." } }),
          { status: 403 },
        ),
      );
    const complete = vi.fn(async () => undefined);

    await expect(
      uploadInventoryCrudTransaction(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch },
        {
          crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
          complete,
        },
      ),
    ).rejects.toMatchObject({ name: "InventoryFailure", message: "Wrong org." });
    expect(complete).not.toHaveBeenCalled();
  });

  it("disconnects and reports halt on 401 so PowerSync does not retry", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }),
          { status: 401 },
        ),
      );
    const complete = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const onUploadHalt = vi.fn();
    await expect(
      uploadInventoryData(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch, onUploadHalt },
        {
          getNextCrudTransaction: async () => ({
            crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
            complete,
          }),
          disconnect,
        },
      ),
    ).rejects.toMatchObject({
      name: "InventoryFailure",
      reason: { _tag: "unauthenticated" },
    });
    expect(onUploadHalt).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not disconnect on transport failures so PowerSync can retry", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const complete = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const onUploadHalt = vi.fn();
    await expect(
      uploadInventoryData(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch, onUploadHalt },
        {
          getNextCrudTransaction: async () => ({
            crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
            complete,
          }),
          disconnect,
        },
      ),
    ).rejects.toMatchObject({ name: "InventoryFailure", reason: { _tag: "transport" } });
    expect(onUploadHalt).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("waitForInventoryFirstSync", () => {
  it("surfaces a timeout instead of treating an aborted wait as a completed sync", async () => {
    await expect(
      waitForInventoryFirstSync(
        {
          currentStatus: { hasSynced: false },
          waitForFirstSync: async (signal) => {
            await new Promise<void>((resolve) => {
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        },
        20,
      ),
    ).rejects.toThrow("The first sync did not finish in time.");
  });

  it("returns once PowerSync reports a completed first sync", async () => {
    await waitForInventoryFirstSync(
      {
        currentStatus: { hasSynced: true },
        waitForFirstSync: async () => undefined,
      },
      20,
    );
  });
});

describe("waitForInventoryUploadDrain", () => {
  it("returns immediately when the upload queue is empty", async () => {
    const getUploadQueueStats = vi.fn(async () => ({ count: 0 }));
    await waitForInventoryUploadDrain({
      getUploadQueueStats,
      currentStatus: { connected: false, connecting: false },
    });
    expect(getUploadQueueStats).toHaveBeenCalledOnce();
  });

  it("refuses when catalog changes are queued and PowerSync is offline", async () => {
    await expect(
      waitForInventoryUploadDrain({
        getUploadQueueStats: async () => ({ count: 2 }),
        currentStatus: { connected: false, connecting: false },
      }),
    ).rejects.toThrow("Wait until catalog changes finish uploading before continuing.");
  });

  it("waits until queued catalog changes finish uploading", async () => {
    const getUploadQueueStats = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await waitForInventoryUploadDrain({
      getUploadQueueStats,
      currentStatus: { connected: true, connecting: false },
    });
    expect(getUploadQueueStats).toHaveBeenCalledTimes(3);
  });

  it("times out if the upload queue does not drain", async () => {
    await expect(
      waitForInventoryUploadDrain(
        {
          getUploadQueueStats: async () => ({ count: 1 }),
          currentStatus: { connected: true, connecting: false },
        },
        0,
      ),
    ).rejects.toThrow("Catalog changes are still uploading. Try again in a moment.");
  });
});

describe("inventory replica database name", () => {
  it("names the SQLite file from a stable hash of the scope", () => {
    const first = inventoryReplicaDatabaseName("https://api.example:org-1");
    const second = inventoryReplicaDatabaseName("https://api.example:org-1");
    const other = inventoryReplicaDatabaseName("https://api.example:org-2");
    expect(first).toMatch(/^powersync-inventory-[0-9a-f]{8}\.sqlite$/u);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first.startsWith("tanstack-")).toBe(false);
  });
});

describe("disconnectAndClearInventoryPowerSync", () => {
  it("clears synced rows then closes", async () => {
    const disconnectAndClear = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    await disconnectAndClearInventoryPowerSync({ disconnectAndClear, close });
    expect(disconnectAndClear.mock.invocationCallOrder[0]).toBeLessThan(
      close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
