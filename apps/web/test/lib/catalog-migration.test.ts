import { describe, expect, it } from "vitest";

import {
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
