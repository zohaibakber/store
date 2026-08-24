import { describe, expect, it } from "vitest";

import { latestCreatedRows, latestMigrationRows } from "../../electron/legacy-migration-catalog";

describe("legacy migration catalog", () => {
  it("keeps the newest copy of each row and sorts the result", () => {
    expect(
      latestMigrationRows([
        { id: "product-b", updatedAt: 200, name: "Older" },
        { id: "product-a", updatedAt: 300, name: "First" },
        { id: "product-b", updatedAt: 400, name: "Newest" },
      ]),
    ).toEqual([
      { id: "product-a", updatedAt: 300, name: "First" },
      { id: "product-b", updatedAt: 400, name: "Newest" },
    ]);
  });

  it("is stable when the same catalog is processed again", () => {
    const once = latestMigrationRows([
      { id: "medicine", updatedAt: 100 },
      { id: "medicine", updatedAt: 100 },
    ]);

    expect(latestMigrationRows([...once, ...once])).toEqual(once);
  });

  it("keeps the newest created copy of each stock movement", () => {
    expect(
      latestCreatedRows([
        { id: "move-b", createdAt: 200 },
        { id: "move-a", createdAt: 300 },
        { id: "move-b", createdAt: 400 },
      ]),
    ).toEqual([
      { id: "move-a", createdAt: 300 },
      { id: "move-b", createdAt: 400 },
    ]);
  });
});
