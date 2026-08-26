import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadLegacyLocalSnapshot,
  lockedLocalDatabasePath,
} from "../../electron/legacy-local-inventory";

describe("legacy local inventory", () => {
  it("reads the signed-out locked replica path", () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), "tabaaq-legacy-inventory-"));
    try {
      mkdirSync(path.join(userDataPath, "locked", "data"), { recursive: true });
      expect(lockedLocalDatabasePath(userDataPath)).toBe(
        path.join(userDataPath, "locked", "data", "store.db"),
      );
    } finally {
      rmSync(userDataPath, { recursive: true });
    }
  });

  it("returns an empty snapshot when the locked database is missing", () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), "tabaaq-legacy-inventory-"));
    try {
      expect(loadLegacyLocalSnapshot(userDataPath)).toEqual({
        categories: [],
        products: [],
        batches: [],
        invoices: [],
        invoiceItems: [],
        stockMovements: [],
      });
    } finally {
      rmSync(userDataPath, { recursive: true });
    }
  });
});
