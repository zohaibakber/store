import {
  SYNC_EPOCH,
  SYNC_PAGE_ROWS,
  SYNC_PAGE_BYTES,
  catalogSliceEntities,
  SyncEntityChange,
  type CatalogPullRequest,
  type CatalogPullResult,
  type CatalogSlice,
} from "@store/contracts";
import { catalogChangeLog, catalogNotificationOutbox } from "@store/db/postgres/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PostgresDrizzle, PostgresTransaction } from "./postgres";

const PULL_LIMIT = SYNC_PAGE_ROWS;

const sliceEntities = (slices: ReadonlyArray<CatalogSlice>) => [
  ...new Set(slices.flatMap((slice) => catalogSliceEntities[slice])),
];

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
  const cursor = Math.max(...inserted.map((row) => row.id));
  yield* tx
    .update(catalogChangeLog)
    .set({ transactionEnd: cursor })
    .where(
      inArray(
        catalogChangeLog.id,
        inserted.map((row) => row.id),
      ),
    );
  yield* tx
    .insert(catalogNotificationOutbox)
    .values({ organizationId, cursor })
    .onConflictDoUpdate({
      target: catalogNotificationOutbox.organizationId,
      set: { cursor },
    });
  return cursor;
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
      transactionEnd: catalogChangeLog.transactionEnd,
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
  const page: typeof rows = [];
  let bytes = 0;
  for (const row of rows.slice(0, PULL_LIMIT)) {
    const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    if (page.length > 0 && bytes + size > SYNC_PAGE_BYTES) break;
    page.push(row);
    bytes += size;
  }
  const hasMore = rows.length > page.length;
  const last = page.at(-1);
  return {
    epoch: SYNC_EPOCH,
    transactionEnd:
      last && last.transactionEnd > 0 && rows[page.length]?.transactionEnd === last.transactionEnd
        ? last.transactionEnd
        : (last?.id ?? request.cursor),
    cursor: last?.id ?? request.cursor,
    changes: page.flatMap((row) => {
      const change = Option.getOrUndefined(
        Schema.decodeUnknownOption(SyncEntityChange)({
          entity: row.entity,
          action: row.action,
          entityId: row.entityId,
          rowVersion: row.rowVersion,
          row: row.row,
        }),
      );
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
  if (request.epoch !== SYNC_EPOCH) {
    return { epoch: SYNC_EPOCH, resetRequired: true, cursor: 0, changes: [], hasMore: false };
  }
  return yield* pullPage(db, organizationId, request);
});
