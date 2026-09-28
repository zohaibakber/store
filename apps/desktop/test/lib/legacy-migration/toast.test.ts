import { describe, expect, it } from "vitest";

import { legacyMigrationToast } from "../../../src/lib/legacy-migration/runner";

describe("legacyMigrationToast", () => {
  it("summarises carried-over and rejected changes in one notice", () => {
    expect(legacyMigrationToast({ carriedOver: 1, rejected: 0 })).toEqual({
      title: "Carried over 1 unsynced change from the previous version",
      type: "success",
    });
    expect(legacyMigrationToast({ carriedOver: 5, rejected: 2 })).toEqual({
      title: "Carried over 5 unsynced changes from the previous version",
      description: "2 changes could not be applied.",
      type: "warning",
    });
    expect(legacyMigrationToast({ carriedOver: 0, rejected: 1 })).toEqual({
      title: "1 change from the previous version could not be applied",
      type: "warning",
    });
  });
});
