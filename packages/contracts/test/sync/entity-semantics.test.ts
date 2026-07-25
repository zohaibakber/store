import type { SyncEntity, SyncEntityChange } from "@store/contracts";
import {
  compareSyncEntityChanges,
  orderSyncEntityChanges,
  syncEntityChangeKey,
  syncEntityDependencyOrder,
} from "@store/contracts";
import { expect, test } from "vitest";

const change = (entity: SyncEntity, entityId: string): SyncEntityChange => ({
  entity,
  entityId,
  action: "upsert",
  rowVersion: 1,
  row: {},
});

test("every protocol entity has an explicit dependency rank", () => {
  expect(Object.keys(syncEntityDependencyOrder).sort()).toEqual(
    ["category", "product", "batch", "invoice", "invoiceItem", "stockMovement"].sort(),
  );
});

test("changes have one deterministic total order", () => {
  const input = [
    change("stockMovement", "movement-1"),
    change("invoice", "invoice-2"),
    change("batch", "batch-2"),
    change("product", "product-1"),
    change("category", "category-1"),
    change("invoiceItem", "item-1"),
    change("invoice", "invoice-1"),
    change("batch", "batch-1"),
  ];
  const reversed = [...input].reverse();

  expect(orderSyncEntityChanges(input)).toEqual(orderSyncEntityChanges(reversed));
  expect(orderSyncEntityChanges(input).map(syncEntityChangeKey)).toEqual([
    "category\u0000category-1",
    "product\u0000product-1",
    "batch\u0000batch-1",
    "batch\u0000batch-2",
    "invoice\u0000invoice-1",
    "invoice\u0000invoice-2",
    "invoiceItem\u0000item-1",
    "stockMovement\u0000movement-1",
  ]);
});

test("comparison and identity use code units rather than locale rules", () => {
  const upper = change("product", "Z");
  const lower = change("product", "a");
  expect(compareSyncEntityChanges(upper, lower)).toBeLessThan(0);
  expect(syncEntityChangeKey(upper)).not.toBe(syncEntityChangeKey(change("batch", "Z")));
});
