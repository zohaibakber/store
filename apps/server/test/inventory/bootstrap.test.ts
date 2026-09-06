import { SYNC_PAGE_ROWS } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { snapshotChangeFromUnknown, snapshotPageFromRows } from "../../src/inventory/bootstrap";

const change = (id: string, rowVersion: number | string = 1) => ({
  entity: "category",
  action: "upsert",
  entityId: id,
  rowVersion,
  row: { id, name: id, rowVersion, tracksPacks: true },
});

describe("catalog snapshot page assembly", () => {
  it("accepts a copied catalog change", () => {
    expect(snapshotChangeFromUnknown(change("one"))).toEqual({
      entity: "category",
      action: "upsert",
      entityId: "one",
      rowVersion: 1,
      row: { id: "one", name: "one", rowVersion: 1, tracksPacks: true },
    });
  });

  it("drops malformed copied rows instead of throwing", () => {
    expect(snapshotChangeFromUnknown({ entity: "category" })).toBeUndefined();
    expect(snapshotChangeFromUnknown(null)).toBeUndefined();
  });

  it("pages copied rows by count without JSON byte measurement", () => {
    const rows = Array.from({ length: SYNC_PAGE_ROWS + 1 }, (_, index) => ({
      id: index + 1,
      change: change(`category-${index}`),
    }));
    const first = snapshotPageFromRows(rows, 0);
    expect(first.changes).toHaveLength(SYNC_PAGE_ROWS);
    expect(first.nextOffset).toBe(SYNC_PAGE_ROWS);
    expect(first.done).toBe(false);

    const last = snapshotPageFromRows(rows.slice(SYNC_PAGE_ROWS), first.nextOffset);
    expect(last.changes).toHaveLength(1);
    expect(last.done).toBe(true);
  });
});
