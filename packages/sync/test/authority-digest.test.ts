import type { SnapshotRow } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { rowImageDigest } from "../src/authority/digest";

const rowA: SnapshotRow = {
  entity: "product",
  entityId: "a",
  rowVersion: 1,
  row: { id: "a", name: "A" },
};

const rowB: SnapshotRow = {
  entity: "product",
  entityId: "b",
  rowVersion: 1,
  row: { id: "b", name: "B" },
};

const rowChanged: SnapshotRow = {
  entity: "product",
  entityId: "a",
  rowVersion: 1,
  row: { id: "a", name: "Z" },
};

describe("authority partition digest", () => {
  it("matches when row images are reordered and differs when one row differs", () => {
    expect(rowImageDigest([rowA, rowB])).toBe(
      "4cba2e77bfa385cb399711c8a84ff117d452aab2ae31120e3119b10bc7062820",
    );
    expect(rowImageDigest([rowB, rowA])).toBe(
      "4cba2e77bfa385cb399711c8a84ff117d452aab2ae31120e3119b10bc7062820",
    );
    expect(rowImageDigest([rowA, rowChanged])).toBe(
      "2a26710e0e1e47b38564dd7e9c3513b747dc141fd739cc616a06cea7cdf53df7",
    );
  });
});
