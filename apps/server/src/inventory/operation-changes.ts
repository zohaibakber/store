import { type SyncEntity, type SyncEntityChange } from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { PostgresTransaction } from "./postgres";
const entityChanges = <
  Row extends {
    readonly id: string;
    readonly rowVersion: number;
    readonly deletedAt: number | null;
  },
>(
  entity: SyncEntity,
  rows: ReadonlyArray<Row>,
): Array<SyncEntityChange> =>
  rows.map((row) => ({
    entity,
    action: row.deletedAt === null ? "upsert" : "delete",
    entityId: row.id,
    rowVersion: row.rowVersion,
    row,
  }));

export const changesForOperation = Effect.fn("InventoryMutation.changesForOperation")(function* (
  tx: PostgresTransaction,
  organizationId: string,
  operationId: string,
) {
  const collected: Array<SyncEntityChange> = [];
  const categoryRows = yield* tx
    .select()
    .from(categories)
    .where(
      and(eq(categories.organizationId, organizationId), eq(categories.operationId, operationId)),
    );
  collected.push(...entityChanges("category", categoryRows));
  const productRows = yield* tx
    .select()
    .from(products)
    .where(and(eq(products.organizationId, organizationId), eq(products.operationId, operationId)));
  collected.push(...entityChanges("product", productRows));
  const batchRows = yield* tx
    .select()
    .from(batches)
    .where(and(eq(batches.organizationId, organizationId), eq(batches.operationId, operationId)));
  collected.push(...entityChanges("batch", batchRows));
  const invoiceRows = yield* tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.operationId, operationId)));
  collected.push(...entityChanges("invoice", invoiceRows));
  const itemRows = yield* tx
    .select()
    .from(invoiceItems)
    .where(
      and(
        eq(invoiceItems.organizationId, organizationId),
        eq(invoiceItems.operationId, operationId),
      ),
    );
  collected.push(...entityChanges("invoiceItem", itemRows));
  const movementRows = yield* tx
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, organizationId),
        eq(stockMovements.operationId, operationId),
      ),
    );
  for (const row of movementRows) {
    collected.push({
      entity: "stockMovement",
      action: "upsert",
      entityId: row.id,
      rowVersion: 1,
      row,
    });
  }
  return collected;
});
