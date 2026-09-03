import { describe, expect, it } from "vitest";

import { persistableRow } from "../src/rows";

describe("persistableRow", () => {
  it("strips TanStack DB virtual props before catalog persistence", () => {
    const row = persistableRow({
      id: "product-1",
      name: "Paracetamol",
      $synced: true,
      $origin: "synced",
      $key: "product-1",
      $collectionId: "products",
    });

    expect(row).toEqual({ id: "product-1", name: "Paracetamol" });
    expect(Object.keys(row)).not.toContain("$synced");
  });
});
