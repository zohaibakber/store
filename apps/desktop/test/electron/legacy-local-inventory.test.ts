import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { decodeCategoryId, decodeInvoiceId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import {
  mergeLoadedMigrationCatalogs,
  mergeMigrationCatalogs,
  migrationDatabasePaths,
  snapshotWithoutReadableLockedReplica,
} from "../../electron/legacy-local-inventory";

describe("legacy local inventory discovery", () => {
  it("discovers both historical organization database layouts", () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), "tabaaq-legacy-inventory-"));
    try {
      mkdirSync(path.join(userDataPath, "organizations", "org-1", "data"), { recursive: true });
      const paths = migrationDatabasePaths(userDataPath);

      expect(paths).toContain(
        path.join(userDataPath, "organizations", "org-1", "data", "store.db"),
      );
      expect(paths).toContain(path.join(userDataPath, "organizations", "org-1", "store.db"));
    } finally {
      rmSync(userDataPath, { recursive: true });
    }
  });

  it("keeps the organization catalog when the locked database is not a full replica", () => {
    const catalog = {
      categories: [
        {
          id: decodeCategoryId("medicine"),
          name: "Medicine",
          tracksPacks: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
    };

    expect(snapshotWithoutReadableLockedReplica(catalog).migrationCatalog).toEqual(catalog);
    expect(snapshotWithoutReadableLockedReplica(catalog).categories).toEqual([]);
  });

  it("merges disjoint catalogs instead of keeping only the largest one", () => {
    const merged = mergeMigrationCatalogs([
      {
        categories: [
          {
            id: decodeCategoryId("medicine"),
            name: "Medicine",
            tracksPacks: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        products: [],
        batches: [],
        invoices: [],
        invoiceItems: [],
        stockMovements: [],
      },
      {
        categories: [],
        products: [],
        batches: [],
        invoices: [
          {
            id: decodeInvoiceId("invoice-1"),
            invoiceNumber: 1,
            customerName: "Walk-in",
            total: 100,
            createdAt: 3,
            updatedAt: 3,
          },
        ],
        invoiceItems: [],
        stockMovements: [],
      },
    ]);

    expect(merged.categories).toHaveLength(1);
    expect(merged.invoices).toHaveLength(1);
  });

  it("refuses to treat a failed catalog read as an empty successful handoff", () => {
    expect(() => mergeLoadedMigrationCatalogs([], 2)).toThrow(/2 database files failed/);
    expect(mergeLoadedMigrationCatalogs([], 0)).toEqual({
      categories: [],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
    });
  });
});
