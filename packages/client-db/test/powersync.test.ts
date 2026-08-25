import { UpdateType } from "@powersync/common";
import { describe, expect, it, vi } from "vitest";

import { InventoryMutationRequestError, shouldRetryInventoryUpload } from "../src/mutations";
import {
  decodePowerSyncCatalogCrudEntry,
  stampCatalogUploadRow,
  uploadInventoryCrudTransaction,
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

  it("keeps the row mutation id instead of a replica-local CRUD sequence", () => {
    expect(stampCatalogUploadRow(category).operationId).toBe("operation-1");
    expect(
      stampCatalogUploadRow({ ...category, id: "category-2", operationId: "operation-2" })
        .operationId,
    ).toBe("operation-2");
  });
});

describe("PowerSync catalog upload failures", () => {
  it("retries auth, timeout, rate-limit, and server failures", () => {
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(401, "expired"))).toBe(
      true,
    );
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(408, "timeout"))).toBe(
      true,
    );
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(429, "slow down"))).toBe(
      true,
    );
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(503, "down"))).toBe(true);
    expect(shouldRetryInventoryUpload(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("does not retry other client errors or local decode failures", () => {
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(400, "bad"))).toBe(false);
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(403, "no"))).toBe(false);
    expect(shouldRetryInventoryUpload(new InventoryMutationRequestError(409, "conflict"))).toBe(
      false,
    );
    expect(shouldRetryInventoryUpload(new Error("Use a soft delete"))).toBe(false);
  });

  it("skips a permanent 409 and still uploads the rest of the batch", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("conflict", { status: 409 }))
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
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const complete = vi.fn(async () => undefined);

    await expect(
      uploadInventoryCrudTransaction(
        { apiBaseUrl: "https://api.example/api", authenticatedFetch },
        {
          crud: [{ id: category.id, table: "categories", op: UpdateType.PUT, opData: category }],
          complete,
        },
      ),
    ).rejects.toThrow(InventoryMutationRequestError);
    expect(complete).not.toHaveBeenCalled();
  });
});
