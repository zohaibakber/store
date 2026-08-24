import {
  LEGACY_MIGRATION_CHUNK_ROWS,
  LegacyBatchMigrationRow,
  LegacyCatalogMigrationCommand,
  LegacyCatalogMigrationResult,
  LegacyCatalogReconciliationResult,
  LegacyCategoryMigrationRow,
  LegacyProductMigrationRow,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

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

const jsonResponse = (body: LegacyCatalogMigrationResult | LegacyCatalogReconciliationResult) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const emptyReconciliation: LegacyCatalogReconciliationResult = {
  deletedCategories: 0,
  deletedProducts: 0,
  deletedBatches: 0,
  deletedInvoices: 0,
  deletedInvoiceItems: 0,
  deletedStockMovements: 0,
  txid: 1,
};

const readCommand = async (request: Request) =>
  Schema.decodeUnknownSync(LegacyCatalogMigrationCommand)(
    Schema.decodeUnknownSync(Schema.Json)(JSON.parse(await request.text())),
  );

/** Server that acknowledges every row it receives. */
const acknowledgingServer = () => {
  const migrations: LegacyCatalogMigrationCommand[] = [];
  let reconciled = false;
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/legacy-reconciliations")) {
      reconciled = true;
      return jsonResponse(emptyReconciliation);
    }
    const command = await readCommand(request);
    migrations.push(command);
    return jsonResponse({ imported: command.rows.length, skipped: 0, txid: 1 });
  };
  return {
    authenticatedFetch,
    migrations,
    get reconciled() {
      return reconciled;
    },
  };
};

describe("legacy catalog upload", () => {
  it("posts rows in Worker-safe chunks, parents first, and then reconciles", async () => {
    const server = acknowledgingServer();

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch: server.authenticatedFetch,
      deviceId: "device-1",
      catalog: {
        ...emptyCatalog,
        categories: [categoryRow("medicine")],
        products: Array.from({ length: 881 }, (_, index) => productRow(index)),
      },
    });

    expect(server.migrations).toHaveLength(37);
    expect(
      server.migrations.every((command) => command.rows.length <= LEGACY_MIGRATION_CHUNK_ROWS),
    ).toBe(true);
    expect(server.migrations[0]?.kind).toBe("categories");
    expect(server.migrations[1]?.kind).toBe("products");
    expect(server.migrations[1]?.commandId).toBe("legacy-v1:device-1:products:0");
    expect(server.migrations[1]?.rows).toHaveLength(25);
    expect(server.migrations.at(-1)?.rows).toHaveLength(6);
    expect(server.reconciled).toBe(true);
  });

  it("never posts a chunk for an empty kind", async () => {
    const server = acknowledgingServer();

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch: server.authenticatedFetch,
      deviceId: "device-1",
      catalog: { ...emptyCatalog, categories: [categoryRow("medicine")] },
    });

    expect(server.migrations.map((command) => command.kind)).toEqual(["categories"]);
  });

  it("treats receipt skips as a full acknowledgement so retries can continue", async () => {
    let calls = 0;
    const authenticatedFetch: typeof fetch = async (input, init) => {
      calls += 1;
      const request = new Request(input, init);
      if (request.url.endsWith("/legacy-reconciliations")) {
        return jsonResponse(emptyReconciliation);
      }
      const command = await readCommand(request);
      return jsonResponse({ imported: 0, skipped: command.rows.length, txid: 1 });
    };

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch,
      deviceId: "device-1",
      catalog: {
        ...emptyCatalog,
        categories: [categoryRow("medicine")],
        products: [productRow(1), productRow(2)],
      },
    });

    expect(calls).toBe(3);
  });

  it("stops uploading after a chunk is only partially acknowledged", async () => {
    let calls = 0;
    const authenticatedFetch: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ imported: 1, skipped: 0, txid: 1 });
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
    ).rejects.toThrow("The server did not confirm every product.");
    expect(calls).toBe(2);
  });

  it("reports the step and row counts behind each chunk", async () => {
    const server = acknowledgingServer();
    const progress: LegacyMigrationProgress[] = [];

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch: server.authenticatedFetch,
      deviceId: "device-1",
      catalog: {
        ...emptyCatalog,
        categories: [categoryRow("medicine")],
        products: Array.from({ length: 30 }, (_, index) => productRow(index)),
      },
      onProgress: (event) => progress.push(event),
    });

    expect(progress).toEqual([
      { step: "categories", uploadedRows: 0, totalRows: 31 },
      { step: "products", uploadedRows: 1, totalRows: 31 },
      { step: "products", uploadedRows: 26, totalRows: 31 },
      { step: "reconcile", uploadedRows: 31, totalRows: 31 },
    ]);
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
