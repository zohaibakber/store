import { describe, expect, it } from "vitest";

import { legacyCatalogMigrated, markLegacyCatalogMigrated } from "../../src/lib/catalog-migration";

describe("legacy catalog migration marker", () => {
  it("remembers a finished handoff per scope so a relaunch skips the upload", () => {
    expect(legacyCatalogMigrated("scope-c")).toBe(false);
    markLegacyCatalogMigrated("scope-c");
    expect(legacyCatalogMigrated("scope-c")).toBe(true);
    expect(legacyCatalogMigrated("scope-d")).toBe(false);
  });
});
