import type { SyncEntity, SyncEntityChange } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ReplicaEntityRowImage } from "./projection";
import type { ReplicaDb } from "./sql-client/drizzle";

const entityTables = {
  category: categories,
  product: products,
  batch: batches,
  invoice: invoices,
  invoiceItem: invoiceItems,
  stockMovement: stockMovements,
} as const;

export const selectEntityRow = Effect.fn("ReplicaRows.selectEntityRow")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
) {
  const table = entityTables[entity];
  const row = yield* tx.select().from(table).where(eq(table.id, entityId)).get();
  return row
    ? (Schema.decodeUnknownSync(syncEntityRows[entity].schema)(row) satisfies ReplicaEntityRowImage)
    : undefined;
});

export const writeEntityRow = Effect.fn("ReplicaRows.writeEntityRow")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  row: SyncEntityChange["row"],
) {
  const table = entityTables[entity];
  const parsed = Schema.decodeUnknownSync(syncEntityRows[entity].schema)(row);
  const existing = yield* tx.select().from(table).where(eq(table.id, parsed.id)).get();
  if (existing) {
    yield* tx.update(table).set(parsed).where(eq(table.id, parsed.id));
    return;
  }
  yield* tx.insert(table).values(parsed);
});

export const removeEntityRow = Effect.fn("ReplicaRows.removeEntityRow")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
) {
  const table = entityTables[entity];
  yield* tx.delete(table).where(eq(table.id, entityId));
});

export const clearEntityRows = Effect.fn("ReplicaRows.clearEntityRows")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
) {
  yield* tx.delete(entityTables[entity]);
});
