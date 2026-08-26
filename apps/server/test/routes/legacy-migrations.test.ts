import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { appFor } from "../lib/app";

const command = {
  requestId: "legacy-catalog:v3:device-1",
  deviceId: "device-1",
  occurredAt: 1_700_000_000_000,
  catalog: {
    categories: [
      {
        id: "medicine",
        name: "Medicine",
        tracksPacks: true,
        createdAt: 1_600_000_000_000,
        updatedAt: 1_650_000_000_000,
      },
    ],
    products: [],
    batches: [],
    invoices: [],
    invoiceItems: [],
    stockMovements: [],
  },
};

describe("legacy catalog migrations", () => {
  it("requires an authenticated organization", async () => {
    const response = await appFor(false).request("/api/inventory/legacy-migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });

    expect(response.status).toBe(401);
  });

  it("creates a queued job without calling an inventory mutation", async () => {
    const startLegacyCatalogMigration = vi.fn(() => Effect.succeed({ jobId: "job-1" }));
    const writeInventoryMutation = vi.fn(() => Effect.succeed({ txid: 42 }));
    const response = await appFor(true, {
      startLegacyCatalogMigration,
      writeInventoryMutation,
    }).request("/api/inventory/legacy-migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId: "job-1" });
    expect(startLegacyCatalogMigration).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      command,
    );
    expect(writeInventoryMutation).not.toHaveBeenCalled();
  });

  it("rejects oversized catalog tables at the HTTP boundary", async () => {
    const response = await appFor(true).request("/api/inventory/legacy-migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...command,
        catalog: {
          ...command.catalog,
          categories: Array.from({ length: 5_001 }, (_, index) => ({
            ...command.catalog.categories[0],
            id: `category-${index}`,
          })),
        },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses legacy catalog uploads from members", async () => {
    const startLegacyCatalogMigration = vi.fn(() => Effect.succeed({ jobId: "job-1" }));
    const response = await appFor(true, {
      role: "member",
      startLegacyCatalogMigration,
    }).request("/api/inventory/legacy-migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });

    expect(response.status).toBe(403);
    expect(startLegacyCatalogMigration).not.toHaveBeenCalled();
  });

  it("returns job progress scoped to the authenticated organization", async () => {
    const status = {
      status: "migrating" as const,
      phase: "products" as const,
      jobId: "job-1",
      processedRows: 10,
      totalRows: 20,
      importedRows: 10,
      skippedRows: 0,
      progress: 50,
    };
    const getLegacyCatalogMigration = vi.fn(() => Effect.succeed(status));
    const response = await appFor(true, { getLegacyCatalogMigration }).request(
      "/api/inventory/legacy-migrations/job-1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(status);
    expect(getLegacyCatalogMigration).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "job-1",
    );
  });

  it("returns not found for a job outside the authenticated organization", async () => {
    const response = await appFor(true, {
      getLegacyCatalogMigration: () => Effect.succeed(null),
    }).request("/api/inventory/legacy-migrations/job-other");

    expect(response.status).toBe(404);
  });

  it("refuses migration status reads from members", async () => {
    const getLegacyCatalogMigration = vi.fn(() =>
      Effect.succeed({
        status: "queued" as const,
        phase: "queued" as const,
        jobId: "job-1",
        processedRows: 0,
        totalRows: 1,
        importedRows: 0,
        skippedRows: 0,
        progress: 0,
      }),
    );
    const response = await appFor(true, {
      role: "member",
      getLegacyCatalogMigration,
    }).request("/api/inventory/legacy-migrations/job-1");

    expect(response.status).toBe(403);
    expect(getLegacyCatalogMigration).not.toHaveBeenCalled();
  });

  it("writes one catalog batch without queueing a job", async () => {
    const migrateLegacyCatalogBatch = vi.fn(() =>
      Effect.succeed({ imported: 1, skipped: 0, txid: 7 }),
    );
    const startLegacyCatalogMigration = vi.fn(() => Effect.succeed({ jobId: "job-1" }));
    const response = await appFor(true, {
      migrateLegacyCatalogBatch,
      startLegacyCatalogMigration,
    }).request("/api/inventory/legacy-migration-batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "categories",
        commandId: "legacy-http:v4:device-1:categories:0",
        deviceId: "device-1",
        occurredAt: 1_700_000_000_000,
        rows: command.catalog.categories,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 1, skipped: 0, txid: 7 });
    expect(migrateLegacyCatalogBatch).toHaveBeenCalledOnce();
    expect(startLegacyCatalogMigration).not.toHaveBeenCalled();
  });
});
