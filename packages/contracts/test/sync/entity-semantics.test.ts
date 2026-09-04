import type { SyncEntity, SyncEntityChange } from "@store/contracts";
import {
  compareSyncEntityChanges,
  syncEntityChangeKey,
} from "@store/contracts";
import { expect, test } from "vitest";

const change = (entity: SyncEntity, entityId: string): SyncEntityChange => ({
  entity,
  entityId,
  action: "upsert",
  rowVersion: 1,
  row: {},
});

test("comparison and identity use code units rather than locale rules", () => {
  const upper = change("product", "Z");
  const lower = change("product", "a");
  expect(compareSyncEntityChanges(upper, lower)).toBeLessThan(0);
  expect(syncEntityChangeKey(upper)).not.toBe(syncEntityChangeKey(change("batch", "Z")));
});
