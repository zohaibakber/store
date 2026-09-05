import {
  SYNC_EPOCH,
  SYNC_PAGE_BYTES,
  SYNC_PAGE_ROWS,
  SyncEntityChange,
  catalogSliceEntities,
  type CatalogSlice,
  type CatalogSnapshotRequest,
  type CatalogSnapshotResult,
} from "@store/contracts";
import {
  batches,
  categories,
  products,
  invoices,
  invoiceItems,
  stockMovements,
  catalogBootstraps,
  catalogBootstrapRows,
  catalogChangeLog,
} from "@store/db/postgres/schema";
import { and, asc, count, desc, eq, getTableColumns, gt, isNull, lt, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PostgresDrizzle, PostgresTransaction } from "./postgres";

const tableSources = [
  { entity: "category", table: categories },
  { entity: "product", table: products },
  { entity: "batch", table: batches },
  { entity: "invoice", table: invoices },
  { entity: "invoiceItem", table: invoiceItems },
  { entity: "stockMovement", table: stockMovements },
] as const;

const copiedRowCount = Effect.fn("CatalogBootstrap.copiedRowCount")(function* (
  tx: PostgresTransaction,
  bootstrapId: string,
  offset?: number,
) {
  const [row] = yield* tx
    .select({ n: count() })
    .from(catalogBootstrapRows)
    .where(
      offset === undefined
        ? eq(catalogBootstrapRows.bootstrapId, bootstrapId)
        : and(
            eq(catalogBootstrapRows.bootstrapId, bootstrapId),
            gt(catalogBootstrapRows.id, offset),
          ),
    );
  return Number(row?.n ?? 0);
});

const createBootstrap = Effect.fn("CatalogBootstrap.create")(function* (
  tx: PostgresTransaction,
  organizationId: string,
  request: CatalogSnapshotRequest,
) {
  const id = crypto.randomUUID();
  const [head] = yield* tx
    .select({ id: catalogChangeLog.id })
    .from(catalogChangeLog)
    .where(eq(catalogChangeLog.organizationId, organizationId))
    .orderBy(desc(catalogChangeLog.id))
    .limit(1);
  const session = {
    id,
    organizationId,
    cursor: head?.id ?? 0,
    slices: [...request.slices].sort().join(","),
    expiresAt: Date.now() + 86_400_000,
  };
  yield* tx.insert(catalogBootstraps).values(session);
  return session;
});

const fillBootstrapRows = Effect.fn("CatalogBootstrap.fill")(function* (
  tx: PostgresTransaction,
  organizationId: string,
  bootstrapId: string,
  slices: ReadonlyArray<CatalogSlice>,
  offset: number,
) {
  const available = yield* copiedRowCount(tx, bootstrapId, offset);
  let remaining = SYNC_PAGE_ROWS + 1 - available;
  if (remaining <= 0) return;
  let skip = yield* copiedRowCount(tx, bootstrapId);
  const entities = new Set(slices.flatMap((slice) => catalogSliceEntities[slice]));
  for (const { entity, table } of tableSources) {
    if (remaining <= 0) return;
    if (!entities.has(entity)) continue;
    const active = "deletedAt" in table ? isNull(table.deletedAt) : sql`true`;
    const [total] = yield* tx
      .select({ n: count() })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), active));
    const tableCount = Number(total?.n ?? 0);
    if (skip >= tableCount) {
      skip -= tableCount;
      continue;
    }
    const fields = Object.entries(getTableColumns(table)).flatMap(([name, column]) => [
      sql`${sql.raw(`'${name}'`)}`,
      sql`${column}`,
    ]);
    const row = sql`jsonb_build_object(${sql.join(fields, sql`, `)})`;
    const version = "rowVersion" in table ? sql`${table.rowVersion}` : sql`1`;
    const before = yield* copiedRowCount(tx, bootstrapId);
    yield* tx.execute(sql`
      insert into ${catalogBootstrapRows} (bootstrap_id, change)
      select ${bootstrapId}, jsonb_build_object('entity', ${entity}::text, 'action', 'upsert',
        'entityId', ${table.id}, 'rowVersion', ${version}, 'row', ${row})
      from ${table}
      where ${table.organizationId} = ${organizationId} and ${active}
      order by ${table.id}
      offset ${skip}
      limit ${remaining}
    `);
    const inserted = (yield* copiedRowCount(tx, bootstrapId)) - before;
    remaining -= inserted;
    skip = 0;
  }
});

export const bootstrapCatalog = Effect.fn("CatalogBootstrap.snapshot")(function* (
  db: PostgresDrizzle,
  organizationId: string,
  request: CatalogSnapshotRequest,
) {
  const reset = {
    epoch: SYNC_EPOCH,
    resetRequired: true,
    cursor: 0,
    changes: [],
  } satisfies CatalogSnapshotResult;
  if (request.epoch !== SYNC_EPOCH) return reset;
  const offset = request.bootstrap?.offset ?? 0;
  const session = request.bootstrap
    ? (yield* db
        .select()
        .from(catalogBootstraps)
        .where(
          and(
            eq(catalogBootstraps.id, request.bootstrap.id),
            eq(catalogBootstraps.organizationId, organizationId),
          ),
        )
        .limit(1))[0]
    : yield* db.transaction(
        (tx) =>
          Effect.gen(function* () {
            const created = yield* createBootstrap(tx, organizationId, request);
            yield* fillBootstrapRows(tx, organizationId, created.id, request.slices, offset);
            return created;
          }),
        { isolationLevel: "repeatable read" },
      );
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    session.slices !== [...request.slices].sort().join(",")
  )
    return reset;
  if (request.bootstrap) {
    yield* db.transaction((tx) =>
      fillBootstrapRows(tx, organizationId, session.id, request.slices, offset),
    );
  }
  const rows = yield* db
    .select()
    .from(catalogBootstrapRows)
    .where(
      and(eq(catalogBootstrapRows.bootstrapId, session.id), gt(catalogBootstrapRows.id, offset)),
    )
    .orderBy(asc(catalogBootstrapRows.id))
    .limit(SYNC_PAGE_ROWS + 1);
  const changes: SyncEntityChange[] = [];
  let nextOffset = offset;
  let bytes = 0;
  for (const entry of rows.slice(0, SYNC_PAGE_ROWS)) {
    const change = Option.getOrUndefined(
      Schema.decodeUnknownOption(SyncEntityChange)(entry.change),
    );
    const size = change ? new TextEncoder().encode(JSON.stringify(change)).byteLength : 0;
    if (change && changes.length > 0 && bytes + size > SYNC_PAGE_BYTES) break;
    if (change) {
      changes.push(change);
      bytes += size;
    }
    nextOffset = entry.id;
  }
  return {
    epoch: SYNC_EPOCH,
    cursor: session.cursor,
    changes,
    bootstrap: {
      id: session.id,
      nextOffset,
      done: rows.length === changes.length,
      expiresAt: session.expiresAt,
    },
  } satisfies CatalogSnapshotResult;
});

export const expireBootstraps = (db: PostgresDrizzle) =>
  db
    .delete(catalogBootstraps)
    .where(lt(catalogBootstraps.expiresAt, Date.now()))
    .pipe(Effect.asVoid);
