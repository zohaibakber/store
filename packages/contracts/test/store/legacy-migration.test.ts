import { expect, test } from "vitest";

import {
  LEGACY_MIGRATION_CHUNK_ROWS,
  LEGACY_ROW_OPERATION_PREFIX,
  MAX_LEGACY_MIGRATION_ROWS,
  chunkLegacyMigrationRows,
  legacyCatalogRowOperationId,
  partitionLegacyMigrationRows,
} from "../../src/store/legacy-migration";

test("legacy catalog rows get a stable id per entity, not the original mutation id", () => {
  const first = legacyCatalogRowOperationId("products", "product-1");
  const sibling = legacyCatalogRowOperationId("products", "product-2");

  expect(first).toBe("legacy-row:v1:products:product-1");
  expect(first.startsWith(LEGACY_ROW_OPERATION_PREFIX)).toBe(true);
  expect(sibling).not.toBe(first);
  expect(legacyCatalogRowOperationId("products", "product-1")).toBe(first);
});

test("retries skip rows that already have a receipt id", () => {
  const rows = [{ id: "product-1" }, { id: "product-2" }, { id: "product-3" }];
  const existing = new Set([legacyCatalogRowOperationId("products", "product-2")]);

  expect(partitionLegacyMigrationRows("products", rows, existing)).toEqual({
    pending: [{ id: "product-1" }, { id: "product-3" }],
    skipped: 1,
  });
  expect(
    partitionLegacyMigrationRows(
      "products",
      rows,
      new Set(rows.map((row) => legacyCatalogRowOperationId("products", row.id))),
    ),
  ).toEqual({
    pending: [],
    skipped: 3,
  });
});

test("queue consumer chunks stay under the Worker-safe Neon transaction size", () => {
  expect(LEGACY_MIGRATION_CHUNK_ROWS).toBeLessThanOrEqual(35);
  expect(LEGACY_MIGRATION_CHUNK_ROWS).toBeLessThanOrEqual(MAX_LEGACY_MIGRATION_ROWS);
  expect(MAX_LEGACY_MIGRATION_ROWS).toBe(250);

  const products = Array.from({ length: 881 }, (_, index) => index);
  const chunks = chunkLegacyMigrationRows(products);
  expect(chunks).toHaveLength(Math.ceil(products.length / LEGACY_MIGRATION_CHUNK_ROWS));
  expect(chunks.every((chunk) => chunk.length <= LEGACY_MIGRATION_CHUNK_ROWS)).toBe(true);
  expect(chunks.at(-1)).toHaveLength(
    products.length % LEGACY_MIGRATION_CHUNK_ROWS || LEGACY_MIGRATION_CHUNK_ROWS,
  );
  expect(chunks.flat()).toEqual(products);
});
