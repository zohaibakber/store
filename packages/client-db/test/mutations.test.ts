import { decodeCategoryId } from "@store/contracts/ids";
import { describe, expect, it, vi } from "vitest";

import { inventoryApiRoot, submitImportInventory } from "../src/mutations";
import type { CategoryRow } from "../src/rows";

const category: CategoryRow = {
  id: decodeCategoryId("category-1"),
  name: "Pain relief",
  tracksPacks: true,
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

describe("inventoryApiRoot", () => {
  it("appends /api unless the base already ends with it", () => {
    expect(inventoryApiRoot("https://api.example")).toBe("https://api.example/api");
    expect(inventoryApiRoot("https://api.example/")).toBe("https://api.example/api");
    expect(inventoryApiRoot("https://api.example/api")).toBe("https://api.example/api");
    expect(inventoryApiRoot("https://api.example/api/")).toBe("https://api.example/api");
  });
});

describe("inventory mutation HTTP", () => {
  it("posts an import command and decodes created counts", async () => {
    const authenticatedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ createdProducts: 1, createdBatches: 2, txid: 9 }), {
        status: 200,
      }),
    );

    await expect(
      submitImportInventory({
        apiBaseUrl: "https://api.example/api",
        authenticatedFetch,
        command: {
          commandId: "command-1",
          deviceId: "device-1",
          occurredAt: 100,
          input: { categoryId: category.id, lines: [] },
        },
      }),
    ).resolves.toEqual({ createdProducts: 1, createdBatches: 2, txid: 9 });

    expect(authenticatedFetch.mock.calls[0]?.[0]).toBe("https://api.example/api/inventory/imports");
  });
});
