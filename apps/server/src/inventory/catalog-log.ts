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
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { PostgresDrizzle, PostgresTransaction } from "./mutation-database";

const PULL_LIMIT = 500;

const sliceEntities = (slices: ReadonlyArray<CatalogSlice>) => [
  ...new Set(slices.flatMap((slice) => catalogSliceEntities[slice])),
];

const LoggedChange = Schema.Struct({
  entity: SyncEntity,
  action: SyncAction,
  entityId: Schema.String,
  rowVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  row: Schema.NullOr(Schema.Json),
});

const toChange = (row: {
  readonly entity: string;
  readonly action: string;
  readonly entityId: string;
  readonly rowVersion: number;
  readonly row: typeof Schema.Json.Type | null;
}): SyncEntityChange | undefined => {
  const decoded = Schema.decodeUnknownOption(LoggedChange)(row).pipe(Option.getOrNull);
  if (!decoded) return undefined;
  return {
    entity: decoded.entity,
    action: decoded.action,
    entityId: decoded.entityId,
    rowVersion: decoded.rowVersion,
    row: decoded.row,
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
    .select()
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
      const payload = Schema.decodeUnknownOption(Schema.NullOr(Schema.Json))(row.row).pipe(
        Option.getOrUndefined,
      );
      if (payload === undefined) return [];
      const change = toChange({
        entity: row.entity,
        action: row.action,
        entityId: row.entityId,
        rowVersion: row.rowVersion,
        row: payload,
      });
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
  const deadline = (yield* Clock.currentTimeMillis) + request.waitMs;
  return yield* pullPage(db, organizationId, request).pipe(
    Effect.repeat({
      until: (page) =>
        Effect.gen(function* () {
          if (page.changes.length > 0) return true;
          return (yield* Clock.currentTimeMillis) >= deadline;
        }),
      schedule: Schedule.spaced(Duration.millis(200)),
    }),
  );
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
  const [cursorRow] = yield* db
    .select({ id: catalogChangeLog.id })
    .from(catalogChangeLog)
    .where(eq(catalogChangeLog.organizationId, organizationId))
    .orderBy(sql`${catalogChangeLog.id} desc`)
    .limit(1);
  return {
    cursor: cursorRow?.id ?? 0,
    changes,
  } satisfies CatalogSnapshotResult;
});
