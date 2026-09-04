import {
  SyncAction,
  SyncEntity,
  catalogSliceEntities,
  type CatalogPullRequest,
  type CatalogPullResult,
  type CatalogSlice,
  type CatalogSnapshotRequest,
  type CatalogSnapshotResult,
  type SyncEntityChange,
} from "@store/contracts";
import {
  batches,
  catalogChangeLog,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { PostgresDrizzle, PostgresTransaction } from "./mutation-database";

const PULL_LIMIT = 50;

const sliceEntities = (slices: ReadonlyArray<CatalogSlice>) => [
  ...new Set(slices.flatMap((slice) => catalogSliceEntities[slice])),
];

const isSyncEntity = (value: string): value is SyncEntity =>
  value === "category" ||
  value === "product" ||
  value === "batch" ||
  value === "invoice" ||
  value === "invoiceItem" ||
  value === "stockMovement";

const isSyncAction = (value: string): value is SyncAction =>
  value === "upsert" || value === "delete";

const toChange = (row: {
  readonly entity: string;
  readonly action: string;
  readonly entityId: string;
  readonly rowVersion: number;
  readonly row: unknown;
}): SyncEntityChange | undefined => {
  if (
    !isSyncEntity(row.entity) ||
    !isSyncAction(row.action) ||
    !Number.isInteger(row.rowVersion) ||
    row.rowVersion < 1
  ) {
    return undefined;
  }
  return {
    entity: row.entity,
    action: row.action,
    entityId: row.entityId,
    rowVersion: row.rowVersion,
    row: row.row,
  };
};

export const appendCatalogChanges = Effect.fn("CatalogLog.append")(function* (
  tx: PostgresTransaction,
  organizationId: string,
  changes: ReadonlyArray<SyncEntityChange>,
  recordedAt: number,
) {
  if (changes.length === 0) {
    const [row] = yield* tx
      .select({ id: catalogChangeLog.id })
      .from(catalogChangeLog)
      .where(eq(catalogChangeLog.organizationId, organizationId))
      .orderBy(sql`${catalogChangeLog.id} desc`)
      .limit(1);
    return row?.id ?? 1;
  }
  const inserted = yield* tx
    .insert(catalogChangeLog)
    .values(
      changes.map((change) => ({
        organizationId,
        entity: change.entity,
        action: change.action,
        entityId: change.entityId,
        rowVersion: change.rowVersion,
        row: change.action === "delete" ? null : change.row,
        recordedAt,
      })),
    )
    .returning({ id: catalogChangeLog.id });
  return Math.max(...inserted.map((row) => row.id));
});

const pullPage = Effect.fn("CatalogLog.pullPage")(function* (
  db: PostgresDrizzle,
  organizationId: string,
  request: CatalogPullRequest,
) {
  const entities = sliceEntities(request.slices);
  const rows = yield* db
    .select({
      id: catalogChangeLog.id,
      entity: catalogChangeLog.entity,
      action: catalogChangeLog.action,
      entityId: catalogChangeLog.entityId,
      rowVersion: catalogChangeLog.rowVersion,
      row: catalogChangeLog.row,
    })
    .from(catalogChangeLog)
    .where(
      and(
        eq(catalogChangeLog.organizationId, organizationId),
        gt(catalogChangeLog.id, request.cursor),
        inArray(catalogChangeLog.entity, [...entities]),
      ),
    )
    .orderBy(asc(catalogChangeLog.id))
    .limit(PULL_LIMIT + 1);
  const hasMore = rows.length > PULL_LIMIT;
  const page = hasMore ? rows.slice(0, PULL_LIMIT) : rows;
  const last = page.at(-1);
  return {
    cursor: last?.id ?? request.cursor,
    changes: page.flatMap((row) => {
      const change = toChange(row);
      return change ? [change] : [];
    }),
    hasMore,
  } satisfies CatalogPullResult;
});

export const pullCatalogChanges = Effect.fn("CatalogLog.pull")(function* (
  db: PostgresDrizzle,
  organizationId: string,
  request: CatalogPullRequest,
) {
  const first = yield* pullPage(db, organizationId, request);
  if (first.changes.length > 0 || request.waitMs === undefined || request.waitMs === 0) {
    return first;
  }
  yield* Effect.sleep(Duration.millis(request.waitMs));
  return first;
});

const rowsAsChanges = (
  entity: SyncEntity,
  rows: ReadonlyArray<{ readonly id: string; readonly rowVersion?: number }>,
): ReadonlyArray<SyncEntityChange> =>
  rows.map((row) => ({
    entity,
    action: "upsert" as const,
    entityId: row.id,
    rowVersion: row.rowVersion ?? 1,
    row,
  }));

export const snapshotCatalog = Effect.fn("CatalogLog.snapshot")(function* (
  db: PostgresDrizzle,
  organizationId: string,
  request: CatalogSnapshotRequest,
) {
  const entities = new Set(sliceEntities(request.slices));
  const changes: Array<SyncEntityChange> = [];
  const [cursorRow] = yield* db
    .select({ id: catalogChangeLog.id })
    .from(catalogChangeLog)
    .where(eq(catalogChangeLog.organizationId, organizationId))
    .orderBy(sql`${catalogChangeLog.id} desc`)
    .limit(1);
  if (entities.has("category")) {
    const rows = yield* db
      .select()
      .from(categories)
      .where(and(eq(categories.organizationId, organizationId), isNull(categories.deletedAt)));
    changes.push(...rowsAsChanges("category", rows));
  }
  if (entities.has("product")) {
    const rows = yield* db
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), isNull(products.deletedAt)));
    changes.push(...rowsAsChanges("product", rows));
  }
  if (entities.has("batch")) {
    const rows = yield* db
      .select()
      .from(batches)
      .where(and(eq(batches.organizationId, organizationId), isNull(batches.deletedAt)));
    changes.push(...rowsAsChanges("batch", rows));
  }
  if (entities.has("invoice")) {
    const rows = yield* db
      .select()
      .from(invoices)
      .where(and(eq(invoices.organizationId, organizationId), isNull(invoices.deletedAt)));
    changes.push(...rowsAsChanges("invoice", rows));
  }
  if (entities.has("invoiceItem")) {
    const rows = yield* db
      .select()
      .from(invoiceItems)
      .where(and(eq(invoiceItems.organizationId, organizationId), isNull(invoiceItems.deletedAt)));
    changes.push(...rowsAsChanges("invoiceItem", rows));
  }
  if (entities.has("stockMovement")) {
    const rows = yield* db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.organizationId, organizationId));
    changes.push(
      ...rows.map((row) => ({
        entity: "stockMovement" as const,
        action: "upsert" as const,
        entityId: row.id,
        rowVersion: 1,
        row,
      })),
    );
  }
  return {
    cursor: cursorRow?.id ?? 0,
    changes,
  } satisfies CatalogSnapshotResult;
});
