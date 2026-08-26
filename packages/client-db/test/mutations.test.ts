import { decodeCategoryId, decodeInvoiceId } from "@store/contracts/ids";
import { describe, expect, it, vi } from "vitest";

import {
  inventoryApiRoot,
  submitCatalogRows,
  submitImportInventory,
  submitIssueInvoice,
} from "../src/mutations";
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
  it("posts catalog rows and decodes the mutation receipt", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ txid: 12 }), { status: 200 }));

    await expect(
      submitCatalogRows({
        apiBaseUrl: "https://api.example",
        authenticatedFetch,
        entity: "category",
        rows: [category],
      }),
    ).resolves.toEqual({ txid: 12 });

    expect(authenticatedFetch).toHaveBeenCalledOnce();
    const [url, init] = authenticatedFetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example/api/inventory/mutations");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operation: { operationId: "operation-1", organizationId: "org-1" },
    });
  });

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

  it("posts an invoice command and decodes the issued invoice", async () => {
    const invoiceId = decodeInvoiceId("invoice-1");
    const authenticatedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ invoiceId, invoiceNumber: 4, txid: 11 }), {
        status: 200,
      }),
    );

    await expect(
      submitIssueInvoice({
        apiBaseUrl: "https://api.example",
        authenticatedFetch,
        command: {
          commandId: "command-2",
          deviceId: "device-1",
          occurredAt: 100,
          input: { customerName: null, items: [] },
        },
      }),
    ).resolves.toEqual({ invoiceId, invoiceNumber: 4, txid: 11 });

    expect(authenticatedFetch.mock.calls[0]?.[0]).toBe("https://api.example/api/inventory/invoices");
  });

  it("rejects a malformed mutation receipt", async () => {
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ txid: "nope" }), { status: 200 }));

    await expect(
      submitCatalogRows({
        apiBaseUrl: "https://api.example",
        authenticatedFetch,
        entity: "category",
        rows: [category],
      }),
    ).rejects.toMatchObject({
      name: "InventoryFailure",
      reason: { _tag: "rejected", code: "INVALID_JSON_RESPONSE" },
    });
  });
});
