import { expect, test } from "vitest";

import { legacyCatalogRowOperationId } from "../../src/store/legacy-migration";

test("legacy catalog rows get a stable id per entity, not the original mutation id", () => {
  const first = legacyCatalogRowOperationId("products", "product-1");
  const sibling = legacyCatalogRowOperationId("products", "product-2");

  expect(first).toBe("legacy-row:v1:products:product-1");
  expect(sibling).not.toBe(first);
  expect(legacyCatalogRowOperationId("products", "product-1")).toBe(first);
});
