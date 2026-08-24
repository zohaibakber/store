import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { migrationDatabasePaths } from "../../electron/legacy-local-inventory";

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
});
