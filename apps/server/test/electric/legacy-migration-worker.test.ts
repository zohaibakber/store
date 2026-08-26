import { LegacyCatalogMigrationStart } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  type LegacyMigrationJobStore,
  type LegacyMigrationProgressUpdate,
  processLegacyMigrationJob,
  terminalMigrationFailure,
} from "../../src/electric/legacy-migration-worker";

const migration = Schema.decodeUnknownSync(LegacyCatalogMigrationStart)({
  requestId: "legacy-catalog:v3:device-1",
  deviceId: "device-1",
  occurredAt: 1_700_000_000_000,
  catalog: {
    categories: [
      {
        id: "medicine",
        name: "Medicine",
        tracksPacks: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    products: Array.from({ length: 12 }, (_, index) => ({
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
    })),
    batches: [],
    invoices: [],
    invoiceItems: [],
    stockMovements: [],
  },
});

const message = { jobId: "job-1", organizationId: "org-1" };

const makeStore = () => {
  const rows = new Map<string, string>();
  const batches: string[] = [];
  const progress: LegacyMigrationProgressUpdate[] = [];
  let status: "queued" | "migrating" | "succeeded" | "failed" = "queued";
  let reconciliations = 0;
  let failedWith: string | undefined;

  const store: LegacyMigrationJobStore = {
    claim: () => {
      if (status === "succeeded" || status === "migrating") {
        return Effect.succeed({ kind: "skip" });
      }
      status = "migrating";
      return Effect.succeed({
        kind: "process",
        actor: { organizationId: "org-1", userId: "user-1" },
        request: migration,
        processedRows: 0,
        importedRows: 0,
        skippedRows: 0,
      });
    },
    migrateBatch: (_actor, command) =>
      Effect.sync(() => {
        batches.push(command.kind);
        for (const row of command.rows) rows.set(`${command.kind}:${row.id}`, row.id);
        return { imported: command.rows.length, skipped: 0, txid: 1 };
      }),
    reconcile: () =>
      Effect.sync(() => {
        reconciliations += 1;
        return {
          deletedCategories: 0,
          deletedProducts: 0,
          deletedBatches: 0,
          deletedInvoices: 0,
          deletedInvoiceItems: 0,
          deletedStockMovements: 0,
          txid: 1,
        };
      }),
    updateProgress: (update) =>
      Effect.sync(() => {
        progress.push(update);
      }),
    succeed: () =>
      Effect.sync(() => {
        status = "succeeded";
      }),
    fail: (failure) =>
      Effect.sync(() => {
        status = "failed";
        failedWith = failure.error;
      }),
  };

  return {
    store,
    rows,
    batches,
    progress,
    get status() {
      return status;
    },
    get reconciliations() {
      return reconciliations;
    },
    get failedWith() {
      return failedWith;
    },
  };
};

describe("legacy migration queue worker", () => {
  it("writes Neon batches and records progress before succeeding", async () => {
    const fixture = makeStore();

    await Effect.runPromise(processLegacyMigrationJob(fixture.store, message, 1));

    expect(fixture.batches).toEqual(["categories", "products", "products"]);
    expect(fixture.rows.size).toBe(13);
    expect(fixture.progress.map((update) => update.phase)).toEqual([
      "categories",
      "categories",
      "products",
      "products",
      "reconcile",
    ]);
    expect(fixture.progress.at(-1)).toMatchObject({
      processedRows: 13,
      importedRows: 13,
      skippedRows: 0,
      progress: 99,
    });
    expect(fixture.reconciliations).toBe(1);
    expect(fixture.status).toBe("succeeded");
  });

  it("acks an at-least-once replay without writing rows twice", async () => {
    const fixture = makeStore();

    await Effect.runPromise(processLegacyMigrationJob(fixture.store, message, 1));
    await Effect.runPromise(processLegacyMigrationJob(fixture.store, message, 1));

    expect(fixture.rows.size).toBe(13);
    expect(fixture.batches).toHaveLength(3);
    expect(fixture.reconciliations).toBe(1);
  });

  it("stores a clear terminal failure for poison messages", async () => {
    const fixture = makeStore();

    await Effect.runPromise(
      terminalMigrationFailure(fixture.store, message)(
        new Error("connection reset"),
      ),
    );

    expect(fixture.status).toBe("failed");
    expect(fixture.failedWith).toBe(
      "Migration failed after several attempts. Reopen the app to try again.",
    );
  });
});
