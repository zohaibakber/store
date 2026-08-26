import {
  LegacyBatchMigrationRow,
  LegacyCatalogMigrationCommand,
  LegacyCategoryMigrationRow,
  LegacyProductMigrationRow,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  type LegacyMigrationProgress,
  migrateLegacyCatalog,
  waitForInventoryFirstSync,
  withoutOrphanRows,
} from "../src/legacy-catalog";

const emptyCatalog = {
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
};

const categoryRow = (id: string): LegacyCategoryMigrationRow =>
  Schema.decodeUnknownSync(LegacyCategoryMigrationRow)({
    id,
    name: "Medicine",
    tracksPacks: true,
    createdAt: 1,
    updatedAt: 1,
  });

const productRow = (index: number): LegacyProductMigrationRow =>
  Schema.decodeUnknownSync(LegacyProductMigrationRow)({
    id: `product-${index}`,
    name: `Product ${index}`,
    categoryId: "medicine",
    aisle: null,
    composition: null,
    strength: null,
    unitsPerPack: 1,
    packPrice: null,
    unitPrice: null,
    visible: true,
    createdAt: 1,
    updatedAt: 1,
  });

const batchRow = (id: string, productId: string): LegacyBatchMigrationRow =>
  Schema.decodeUnknownSync(LegacyBatchMigrationRow)({
    id,
    productId,
    batchNumber: null,
    expiresAt: null,
    packQuantity: 1,
    unitQuantity: 0,
    createdAt: 1,
    updatedAt: 1,
  });

const jsonResponse = (body: typeof Schema.Json.Type, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const migrationServer = () => {
  const batches: LegacyCatalogMigrationCommand[] = [];
  let reconciliations = 0;
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(await request.text()));
    if (url.pathname.endsWith("/legacy-migration-batches")) {
      const command = Schema.decodeUnknownSync(LegacyCatalogMigrationCommand)(body);
      batches.push(command);
      return jsonResponse({
        imported: command.rows.length,
        skipped: 0,
        txid: batches.length,
      });
    }
    if (url.pathname.endsWith("/legacy-reconciliations")) {
      reconciliations += 1;
      return jsonResponse({
        deletedCategories: 0,
        deletedProducts: 0,
        deletedBatches: 0,
        deletedInvoices: 0,
        deletedInvoiceItems: 0,
        deletedStockMovements: 0,
        txid: 99,
      });
    }
    return jsonResponse({ error: "unexpected" }, 404);
  };
  return {
    authenticatedFetch,
    batches,
    get reconciliations() {
      return reconciliations;
    },
  };
};

describe("legacy catalog upload", () => {
  it("writes catalog chunks then reconciles without a queue job", async () => {
    const server = migrationServer();
    const progress: LegacyMigrationProgress[] = [];

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch: server.authenticatedFetch,
      deviceId: "device-1",
      catalog: {
        ...emptyCatalog,
        categories: [categoryRow("medicine")],
        products: [productRow(1), productRow(2)],
      },
      onProgress: (status) => progress.push(status),
    });

    expect(server.batches.map((batch) => batch.kind)).toEqual(["categories", "products"]);
    expect(server.batches[0]?.rows).toHaveLength(1);
    expect(server.batches[1]?.rows).toHaveLength(2);
    expect(server.reconciliations).toBe(1);
    expect(progress.map((status) => status.status)).toEqual([
      "queued",
      "migrating",
      "migrating",
      "migrating",
      "succeeded",
    ]);
  });

  it("surfaces a failed catalog batch", async () => {
    let calls = 0;
    const authenticatedFetch: typeof fetch = async () => {
      calls += 1;
      return new Response("Neon rejected the product batch.", { status: 400 });
    };

    await expect(
      migrateLegacyCatalog({
        apiBaseUrl: "https://api.tabaaq.app",
        authenticatedFetch,
        deviceId: "device-1",
        catalog: {
          ...emptyCatalog,
          categories: [categoryRow("medicine")],
          products: [productRow(1), productRow(2)],
        },
      }),
    ).rejects.toThrow("Neon rejected the product batch.");
    expect(calls).toBe(1);
  });

  it("does not create a job for an empty local catalog", async () => {
    const authenticatedFetch = vi.fn<typeof fetch>();

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch,
      deviceId: "device-1",
      catalog: emptyCatalog,
    });

    expect(authenticatedFetch).not.toHaveBeenCalled();
  });
});

describe("orphan rows", () => {
  it("drops children whose parent is missing so one bad row cannot fail a chunk", () => {
    const catalog = {
      ...emptyCatalog,
      categories: [categoryRow("medicine")],
      products: [productRow(1)],
      batches: [batchRow("batch-live", "product-1"), batchRow("batch-orphan", "product-deleted")],
    };

    const kept = withoutOrphanRows(catalog);

    expect(kept.products).toHaveLength(1);
    expect(kept.batches.map((batch) => batch.id)).toEqual(["batch-live"]);
  });

  it("drops products whose category is gone, along with their batches", () => {
    const kept = withoutOrphanRows({
      ...emptyCatalog,
      products: [productRow(1)],
      batches: [batchRow("batch-live", "product-1")],
    });

    expect(kept.products).toEqual([]);
    expect(kept.batches).toEqual([]);
  });
});

describe("first sync wait", () => {
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
