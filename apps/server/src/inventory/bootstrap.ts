import {
  SYNC_EPOCH,
  SYNC_PAGE_ROWS,
  catalogSliceEntities,
  SyncEntityChange,
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
import { and, asc, desc, eq, getTableColumns, gt, isNull, lt, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PostgresDrizzle, PostgresTransaction } from "./postgres";

const tableSources = [
  { entity: "category" as const, table: categories },
  { entity: "product" as const, table: products },
  { entity: "batch" as const, table: batches },
  { entity: "invoice" as const, table: invoices },
  { entity: "invoiceItem" as const, table: invoiceItems },
  { entity: "stockMovement" as const, table: stockMovements },
];

const compiledSources = tableSources.map(({ entity, table }) => {
  const fields = Object.entries(getTableColumns(table)).flatMap(([name, column]) => [
    sql`${sql.raw(`'${name}'`)}`,
    sql`${column}`,
  ]);
  return {
    entity,
    table,
    active: "deletedAt" in table ? isNull(table.deletedAt) : sql`true`,
    change: sql`jsonb_build_object('entity', ${sql.raw(`'${entity}'`)}::text, 'action', 'upsert',
      'entityId', ${table.id}, 'rowVersion', ${"rowVersion" in table ? sql`${table.rowVersion}` : sql`1`},
      'row', jsonb_build_object(${sql.join(fields, sql`, `)}))`,
  };
});

type JsonValue = typeof Schema.Json.Type;

export const snapshotChangeFromUnknown = (encoded: JsonValue): SyncEntityChange | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(SyncEntityChange)(encoded));

export const snapshotPageFromRows = (
  rows: ReadonlyArray<{ readonly id: number; readonly change: JsonValue }>,
  fallbackOffset: number,
) => {
  const page = rows.slice(0, SYNC_PAGE_ROWS);
  const changes: SyncEntityChange[] = [];
  let nextOffset = fallbackOffset;
  for (const entry of page) {
    nextOffset = entry.id;
    const change = snapshotChangeFromUnknown(entry.change);
    if (change) changes.push(change);
  }
  return {
    changes,
    nextOffset,
    done: rows.length <= SYNC_PAGE_ROWS,
  };
};

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

const lastCopiedChange = Effect.fn("CatalogBootstrap.lastCopied")(function* (
  tx: PostgresTransaction,
  bootstrapId: string,
) {
  const [row] = yield* tx
    .select({ change: catalogBootstrapRows.change })
    .from(catalogBootstrapRows)
    .where(eq(catalogBootstrapRows.bootstrapId, bootstrapId))
    .orderBy(desc(catalogBootstrapRows.id))
    .limit(1);
  const encoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Json)(row?.change ?? null),
  );
  return encoded === undefined || encoded === null ? undefined : snapshotChangeFromUnknown(encoded);
});

const fillBootstrapRows = Effect.fn("CatalogBootstrap.fill")(function* (
  tx: PostgresTransaction,
  organizationId: string,
  bootstrapId: string,
  slices: ReadonlyArray<CatalogSlice>,
  remaining: number,
) {
  if (remaining <= 0) return;
  const entities = new Set(slices.flatMap((slice) => catalogSliceEntities[slice]));
  const sources = compiledSources.filter((source) => entities.has(source.entity));
  if (sources.length === 0) return;
  const resume = yield* lastCopiedChange(tx, bootstrapId);
  const resumeIndex = resume ? sources.findIndex((source) => source.entity === resume.entity) : -1;
  const parts = sources.map(
    (source, index) => sql`(
      select ${index}::int as src, ${source.table.id}::text as id, ${source.change} as change
      from ${source.table}
      where ${source.table.organizationId} = ${organizationId} and ${source.active}
    )`,
  );
  yield* tx.execute(sql`
    insert into ${catalogBootstrapRows} (bootstrap_id, change)
    select ${bootstrapId}, pages.change
    from (
      ${sql.join(parts, sql` union all `)}
    ) pages
    where ${resumeIndex < 0 ? sql`true` : sql`(pages.src, pages.id) > (${resumeIndex}, ${resume?.entityId ?? ""})`}
    order by pages.src, pages.id
    limit ${remaining}
  `);
});

const readBootstrapPage = (
  db: PostgresDrizzle | PostgresTransaction,
  bootstrapId: string,
  offset: number,
) =>
  db
    .select({ id: catalogBootstrapRows.id, change: catalogBootstrapRows.change })
    .from(catalogBootstrapRows)
    .where(
      and(eq(catalogBootstrapRows.bootstrapId, bootstrapId), gt(catalogBootstrapRows.id, offset)),
    )
    .orderBy(asc(catalogBootstrapRows.id))
    .limit(SYNC_PAGE_ROWS + 1);

const resetSnapshot = {
  epoch: SYNC_EPOCH,
  resetRequired: true,
  cursor: 0,
  changes: [],
} satisfies CatalogSnapshotResult;

export const bootstrapCatalog = Effect.fn("CatalogBootstrap.snapshot")(function* (
  db: PostgresDrizzle,
  organizationId: string,
  request: CatalogSnapshotRequest,
) {
  if (request.epoch !== SYNC_EPOCH) return resetSnapshot;
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
    : undefined;
  if (request.bootstrap && !session) return resetSnapshot;
  if (
    session &&
    (session.expiresAt <= Date.now() || session.slices !== [...request.slices].sort().join(","))
  )
    return resetSnapshot;

  const paged = yield* db.transaction(
    (tx) =>
      Effect.gen(function* () {
        const current = session ?? (yield* createBootstrap(tx, organizationId, request));
        const existing = session ? yield* readBootstrapPage(tx, current.id, offset) : [];
        if (existing.length <= SYNC_PAGE_ROWS) {
          yield* fillBootstrapRows(
            tx,
            organizationId,
            current.id,
            request.slices,
            SYNC_PAGE_ROWS + 1 - existing.length,
          );
        }
        const rows =
          existing.length > SYNC_PAGE_ROWS
            ? existing
            : yield* readBootstrapPage(tx, current.id, offset);
        return { current, rows };
      }),
    { isolationLevel: "repeatable read" },
  );
  const page = snapshotPageFromRows(
    paged.rows.flatMap((entry) => {
      const change = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(entry.change));
      return change === undefined || change === null ? [] : [{ id: entry.id, change }];
    }),
    offset,
  );
  return {
    epoch: SYNC_EPOCH,
    cursor: paged.current.cursor,
    changes: page.changes,
    bootstrap: {
      id: paged.current.id,
      nextOffset: page.nextOffset,
      done: page.done,
      expiresAt: paged.current.expiresAt,
    },
  } satisfies CatalogSnapshotResult;
});

export const expireBootstraps = (db: PostgresDrizzle) =>
  db
    .delete(catalogBootstraps)
    .where(lt(catalogBootstraps.expiresAt, Date.now()))
    .pipe(Effect.asVoid);
