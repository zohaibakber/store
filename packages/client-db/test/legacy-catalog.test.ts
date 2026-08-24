import {
  LEGACY_MIGRATION_CHUNK_ROWS,
  LegacyCatalogMigrationCommand,
  LegacyCatalogMigrationResult,
  LegacyCatalogReconciliationResult,
  LegacyProductMigrationRow,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { migrateLegacyCatalog, waitForInventoryFirstSync } from "../src/legacy-catalog";

const emptyCatalog = {
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
};

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

describe("legacy catalog upload", () => {
  it("posts product backups in Worker-safe chunks and then reconciles", async () => {
    const migrations: LegacyCatalogMigrationCommand[] = [];
    let reconciled = false;
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/legacy-reconciliations")) {
        reconciled = true;
        return jsonResponse(emptyReconciliation);
      }
      const command = Schema.decodeUnknownSync(LegacyCatalogMigrationCommand)(
        Schema.decodeUnknownSync(Schema.Json)(JSON.parse(await request.text())),
      );
      migrations.push(command);
      return jsonResponse({ imported: command.rows.length, skipped: 0, txid: 1 });
    };

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch,
      deviceId: "device-1",
      catalog: {
        ...emptyCatalog,
        products: Array.from({ length: 881 }, (_, index) => productRow(index)),
      },
    });

    expect(migrations).toHaveLength(36);
    expect(migrations.every((command) => command.rows.length <= LEGACY_MIGRATION_CHUNK_ROWS)).toBe(
      true,
    );
    expect(migrations[0]?.kind).toBe("products");
    expect(migrations[0]?.rows).toHaveLength(25);
    expect(migrations[0]?.commandId).toBe("legacy-v1:device-1:products:0");
    expect(migrations.at(-1)?.rows).toHaveLength(6);
    expect(reconciled).toBe(true);
  });

  it("treats receipt skips as a full acknowledgement so retries can continue", async () => {
    let calls = 0;
    const authenticatedFetch: typeof fetch = async (input) => {
      calls += 1;
      const request = new Request(input);
      if (request.url.endsWith("/legacy-reconciliations")) {
        return jsonResponse(emptyReconciliation);
      }
      return jsonResponse({ imported: 0, skipped: 2, txid: 1 });
    };

    await migrateLegacyCatalog({
      apiBaseUrl: "https://api.tabaaq.app",
      authenticatedFetch,
      deviceId: "device-1",
      catalog: { ...emptyCatalog, products: [productRow(1), productRow(2)] },
    });

    expect(calls).toBe(2);
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
        catalog: { ...emptyCatalog, products: [productRow(1), productRow(2)] },
      }),
    ).rejects.toThrow("The local product backup was not fully acknowledged by the server.");
    expect(calls).toBe(1);
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
    ).rejects.toThrow("Catalog sync did not finish. Keep Tabaaq open and try again.");
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
