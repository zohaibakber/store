import { expect, test } from "vitest";

import { syncEntityRows } from "../../src/sync/entity-rows";
import { replicaEntitySchemas } from "../../src/sync/replica-model";
import type { SyncEntity } from "../../src/sync/schema";

const entities = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
] as const satisfies ReadonlyArray<SyncEntity>;

test("replica entity schemas are the same codecs as entity-rows", () => {
  for (const entity of entities) {
    expect(replicaEntitySchemas[entity]).toBe(syncEntityRows[entity].schema);
  }
});
