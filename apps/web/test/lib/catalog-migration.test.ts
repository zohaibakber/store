import { decodeCategoryId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import {
  catalogRowCount,
  completeLegacyCatalogHandoff,
  legacyCatalogMigrated,
  legacyCatalogMigrationToast,
  markLegacyCatalogMigrated,
} from "../../src/lib/catalog-migration";

describe("legacy catalog migration marker", () => {
  it("remembers a finished handoff per scope so a relaunch skips the upload", () => {
    expect(legacyCatalogMigrated("scope-c")).toBe(false);
    markLegacyCatalogMigrated("scope-c");
    expect(legacyCatalogMigrated("scope-c")).toBe(true);
    expect(legacyCatalogMigrated("scope-d")).toBe(false);
  });
});

describe("legacy catalog migration toast", () => {
  const progress = {
    jobId: "job-1",
    processedRows: 25,
    totalRows: 100,
    importedRows: 24,
    skippedRows: 1,
    progress: 25,
  };

  it("maps queued and migrating jobs to persistent progress feedback", () => {
    expect(
      legacyCatalogMigrationToast({
        status: "queued",
        phase: "queued",
        ...progress,
      }),
    ).toEqual({
      kind: "queued",
      description: "Your inventory migration is queued.",
    });
    expect(
      legacyCatalogMigrationToast({
        status: "migrating",
        phase: "products",
        ...progress,
      }),
    ).toEqual({
      kind: "migrating",
      label: "Migrating products…",
      progress: 25,
    });
  });

  it("maps terminal jobs to success or error feedback", () => {
    expect(
      legacyCatalogMigrationToast({
        status: "succeeded",
        phase: "complete",
        ...progress,
      }),
    ).toEqual({
      kind: "success",
      description: "24 rows migrated to Neon.",
    });
    expect(
      legacyCatalogMigrationToast({
        status: "failed",
        phase: "products",
        error: "Neon is unavailable.",
        ...progress,
      }),
    ).toEqual({
      kind: "error",
      description: "Neon is unavailable.",
    });
  });
});

const emptyCatalog = {
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
};

describe("legacy catalog handoff", () => {
  it("counts rows across every catalog table", () => {
    expect(catalogRowCount(emptyCatalog)).toBe(0);
    expect(
      catalogRowCount({
        ...emptyCatalog,
        categories: [
          {
            id: decodeCategoryId("medicine"),
            name: "Medicine",
            tracksPacks: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    ).toBe(1);
  });

  it("connects without uploading when there is no local catalog", async () => {
    await expect(
      completeLegacyCatalogHandoff({
        scopeId: "scope-empty",
        loadCatalog: async () => emptyCatalog,
        migrate: async () => {
          throw new Error("should not migrate an empty catalog");
        },
        reportError: () => {
          throw new Error("should not report");
        },
      }),
    ).resolves.toBe("connect");
    expect(legacyCatalogMigrated("scope-empty")).toBe(true);
  });

  it("holds and does not mark migrated when load or upload fails", async () => {
    const reported: unknown[] = [];
    await expect(
      completeLegacyCatalogHandoff({
        scopeId: "scope-fail",
        loadCatalog: async () => {
          throw new Error("snapshot ipc failed");
        },
        migrate: async () => undefined,
        reportError: (cause) => {
          reported.push(cause);
        },
      }),
    ).resolves.toBe("hold");
    expect(legacyCatalogMigrated("scope-fail")).toBe(false);
    expect(reported).toHaveLength(1);
  });
});
