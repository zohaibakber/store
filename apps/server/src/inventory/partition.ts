import type { PartitionEntity, SnapshotRow } from "@store/contracts";
import { batches, categories, products } from "@store/db/postgres/schema";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { InventoryTransaction } from "./postgres";

const PARTITION_PAGE_ROWS = 1000;

const partitionRows = (
  entity: PartitionEntity,
  rows: ReadonlyArray<{ readonly id: string; readonly rowVersion: number }>,
): ReadonlyArray<SnapshotRow> =>
  rows.map((row) => ({ entity, entityId: row.id, rowVersion: row.rowVersion, row }));

const partitionScope = (organizationId: string, entity: PartitionEntity) => {
  switch (entity) {
    case "category":
      return { table: categories, where: eq(categories.organizationId, organizationId) };
    case "product":
      return {
        table: products,
        where: and(eq(products.organizationId, organizationId), isNull(products.deletedAt)),
      };
    case "batch":
      return {
        table: batches,
        where: and(eq(batches.organizationId, organizationId), isNull(batches.deletedAt)),
      };
  }
};

export const readPartitionPage = (
  tx: InventoryTransaction,
  organizationId: string,
  entity: PartitionEntity,
  after: string | undefined,
  limit: number,
) => {
  const { table, where } = partitionScope(organizationId, entity);
  return tx
    .select()
    .from(table)
    .where(and(where, after === undefined ? undefined : gt(table.id, after)))
    .orderBy(asc(table.id))
    .limit(limit)
    .pipe(Effect.map((rows) => partitionRows(entity, rows)));
};

export const readPartitionRows = Effect.fn("InventoryPartition.readRows")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  entity: PartitionEntity,
) {
  const collected: SnapshotRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = yield* readPartitionPage(tx, organizationId, entity, after, PARTITION_PAGE_ROWS);
    collected.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < PARTITION_PAGE_ROWS) return collected;
    after = last.entityId;
  }
});

export const countPartitionRows = Effect.fn("InventoryPartition.countRows")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  entity: PartitionEntity,
) {
  const { table, where } = partitionScope(organizationId, entity);
  const [row] = yield* tx.select({ rowCount: count() }).from(table).where(where);
  return row?.rowCount ?? 0;
});
