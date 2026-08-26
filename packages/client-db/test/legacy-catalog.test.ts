import {
  LegacyBatchMigrationRow,
  LegacyCatalogMigrationStart,
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

const jsonResponse = (body: typeof Schema.Json.Type) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const readCommand = async (request: Request) =>
  Schema.decodeUnknownSync(LegacyCatalogMigrationStart)(
    Schema.decodeUnknownSync(Schema.Json)(JSON.parse(await request.text())),
  );

const migrationServer = () => {
  const migrations: LegacyCatalogMigrationStart[] = [];
  let statusReads = 0;
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "GET") {
      statusReads += 1;
      return statusReads === 1
        ? jsonResponse({
            status: "migrating",
            phase: "products",
            jobId: "job-1",
            processedRows: 1,
            totalRows: 3,
            importedRows: 1,
            skippedRows: 0,
            progress: 33,
          })
        : jsonResponse({
            status: "succeeded",
            phase: "complete",
            jobId: "job-1",
            processedRows: 3,
            totalRows: 3,
            importedRows: 3,
            skippedRows: 0,
            progress: 100,
          });
    }
    const command = await readCommand(request);
    migrations.push(command);
    return jsonResponse({ jobId: "job-1" });
  };
  return {
    authenticatedFetch,
    migrations,
    get statusReads() {
      return statusReads;
    },
  };
};

describe("legacy catalog upload", () => {
  it("starts one queued job and polls until Neon migration succeeds", async () => {
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
      pollIntervalMs: 0,
    });

    expect(server.migrations).toHaveLength(1);
    expect(server.migrations[0]?.requestId).toBe("legacy-catalog:v3:device-1");
    expect(server.migrations[0]?.catalog.categories).toHaveLength(1);
    expect(server.migrations[0]?.catalog.products).toHaveLength(2);
    expect(server.statusReads).toBe(2);
    expect(progress.map((status) => status.status)).toEqual([
      "queued",
      "migrating",
      "succeeded",
    ]);
  });

  it("surfaces the terminal failed state from the worker", async () => {
    let calls = 0;
    const authenticatedFetch: typeof fetch = async (input, init) => {
      calls += 1;
      const request = new Request(input, init);
      if (request.method === "POST") return jsonResponse({ jobId: "job-failed" });
      return jsonResponse({
        status: "failed",
        phase: "products",
        jobId: "job-failed",
        processedRows: 1,
        totalRows: 3,
        importedRows: 1,
        skippedRows: 0,
        progress: 33,
        error: "Neon rejected the product batch.",
      });
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
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow("Neon rejected the product batch.");
    expect(calls).toBe(2);
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
