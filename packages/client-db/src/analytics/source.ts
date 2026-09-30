import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import {
  INSIGHTS_DAY_MILLIS,
  INSIGHTS_HOUR_MILLIS,
  insightsDayStart,
  type InsightsBatchFact,
  type InsightsProductFact,
  type ReplicaInsightsWindow,
} from "@store/contracts";
import { and, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import { visibleBatches } from "../replica/compile";
import { analyticsFailure, type AnalyticsFailure } from "./errors";
import type { SalesRow } from "./store";

const BUSY_TIMEOUT_MILLIS = 5_000;
const PREPARED_STATEMENTS = 64;
const FIRST = "\u0000first";
const LAST = "\u0000last";
const ORGANIZATION = "\u0000organization";

export type InventoryStamp = { readonly generation: string; readonly version: number };

type DayFact = { readonly day: number; readonly invoices: number; readonly revenue: number };
type HourFact = {
  readonly hour: number;
  readonly invoices: number;
  readonly revenue: number;
};

export type SalesDays = {
  readonly firstDay: number;
  readonly lastDay: number;
  readonly utcOffsetMinutes: number;
};

type TouchedResolution = {
  readonly productIds: ReadonlySet<string>;
  readonly unresolved: boolean;
  readonly overflow: boolean;
};

export type InventorySnapshot = {
  readonly organizationId: string;
  readonly stamp: InventoryStamp;
  readonly productCount: () => number;
  readonly productPage: (after: string, limit: number) => ReadonlyArray<InsightsProductFact>;
  readonly productsByIds: (ids: ReadonlyArray<string>) => ReadonlyArray<InsightsProductFact>;
  readonly batchesBetween: (firstId: string, lastId: string) => ReadonlyArray<InsightsBatchFact>;
  readonly batchesForProducts: (ids: ReadonlyArray<string>) => ReadonlyArray<InsightsBatchFact>;
  readonly windowFacts: (window: ReplicaInsightsWindow) => {
    readonly days: ReadonlyArray<DayFact>;
    readonly hours: ReadonlyArray<HourFact>;
  };
  readonly sales: (range: SalesDays, productIds?: ReadonlyArray<string>) => ReadonlyArray<SalesRow>;
  readonly resolveTouched: (keys: ReadonlyArray<string>, maxProducts: number) => TouchedResolution;
};

export type InventorySource = {
  readonly snapshot: <A, E, R>(
    work: (snapshot: InventorySnapshot) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | AnalyticsFailure, R>;
};

const queryBuilder = new QueryBuilder();

const batchesBetweenStatement = (() => {
  const built = queryBuilder
    .with(visibleBatches)
    .select({
      productId: visibleBatches.productId,
      batchNumber: visibleBatches.batchNumber,
      packQuantity: visibleBatches.packQuantity,
      unitQuantity: visibleBatches.unitQuantity,
      expiresAt: visibleBatches.expiresAt,
    })
    .from(visibleBatches)
    .where(
      and(
        eq(visibleBatches.organizationId, ORGANIZATION),
        gte(visibleBatches.productId, FIRST),
        lte(visibleBatches.productId, LAST),
        or(ne(visibleBatches.packQuantity, 0), ne(visibleBatches.unitQuantity, 0)),
      ),
    )
    .orderBy(visibleBatches.productId, visibleBatches.expiresAt)
    .toSQL();
  return { sql: built.sql, params: built.params };
})();

const batchesForProductsStatement = (() => {
  const built = queryBuilder
    .with(visibleBatches)
    .select({
      productId: visibleBatches.productId,
      batchNumber: visibleBatches.batchNumber,
      packQuantity: visibleBatches.packQuantity,
      unitQuantity: visibleBatches.unitQuantity,
      expiresAt: visibleBatches.expiresAt,
    })
    .from(visibleBatches)
    .where(
      and(
        eq(visibleBatches.organizationId, ORGANIZATION),
        sql`${visibleBatches.productId} IN (SELECT value FROM json_each(${FIRST}))`,
        or(ne(visibleBatches.packQuantity, 0), ne(visibleBatches.unitQuantity, 0)),
      ),
    )
    .orderBy(visibleBatches.productId, visibleBatches.expiresAt)
    .toSQL();
  return { sql: built.sql, params: built.params };
})();

const ProductRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  categoryId: Schema.String,
  categoryName: Schema.NullOr(Schema.String),
  tracksPacks: Schema.Number,
  unitsPerPack: Schema.Number,
  purchasePrice: Schema.NullOr(Schema.Number),
  retailPrice: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
  visible: Schema.Number,
  createdAt: Schema.Number,
});
const decodeProducts = Schema.decodeUnknownSync(Schema.Array(ProductRow));

const BatchRow = Schema.Struct({
  productId: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number),
});
const decodeBatches = Schema.decodeUnknownSync(Schema.Array(BatchRow));

const StateRow = Schema.Struct({
  organizationId: Schema.String,
  generation: Schema.Number,
  version: Schema.Number,
});
const decodeState = Schema.decodeUnknownSync(StateRow);

const SaleRow = Schema.Struct({
  productId: Schema.String,
  day: Schema.Number,
  units: Schema.Number,
  revenue: Schema.Number,
});
const decodeSales = Schema.decodeUnknownSync(Schema.Array(SaleRow));

const DayRow = Schema.Struct({
  day: Schema.Number,
  invoices: Schema.Number,
  revenue: Schema.Number,
});
const HourRow = Schema.Struct({
  hour: Schema.Number,
  invoices: Schema.Number,
  revenue: Schema.Number,
});
const decodeDays = Schema.decodeUnknownSync(Schema.Array(DayRow));
const decodeHours = Schema.decodeUnknownSync(Schema.Array(HourRow));

const IdRow = Schema.Struct({ id: Schema.String });
const decodeIds = Schema.decodeUnknownSync(Schema.Array(IdRow));
const ProductIdRow = Schema.Struct({ id: Schema.String, productId: Schema.String });
const decodeProductIds = Schema.decodeUnknownSync(Schema.Array(ProductIdRow));
const decodeDistinctProducts = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ productId: Schema.String })),
);

const keyParts = (key: string): { readonly entity: string; readonly id: string } | undefined => {
  const separator = key.indexOf(":");
  return separator <= 0
    ? undefined
    : { entity: key.slice(0, separator), id: key.slice(separator + 1) };
};

const PRODUCT_COLUMNS = `p.id AS id, p.name AS name, p.categoryId AS categoryId, c.name AS categoryName,
       coalesce(c.tracksPacks, 1) AS tracksPacks, max(p.unitsPerPack, 1) AS unitsPerPack,
       p.purchasePrice AS purchasePrice, p.retailPrice AS retailPrice, p.unitPrice AS unitPrice,
       p.visible AS visible, p.createdAt AS createdAt`;

const PRODUCT_FROM = `FROM products p
  LEFT JOIN categories c ON c.organizationId = p.organizationId AND c.id = p.categoryId`;

const toProductFact = (row: typeof ProductRow.Type): InsightsProductFact => ({
  id: row.id,
  name: row.name,
  categoryId: row.categoryId,
  categoryName: row.categoryName,
  tracksPacks: row.tracksPacks !== 0,
  unitsPerPack: row.unitsPerPack,
  purchasePrice: row.purchasePrice,
  retailPrice: row.retailPrice,
  unitPrice: row.unitPrice,
  visible: row.visible !== 0,
  createdAt: row.createdAt,
});

const makeSnapshot = (
  db: DatabaseSync,
  statements: Map<string, StatementSync>,
): InventorySnapshot => {
  const prepare = (query: string) => {
    const cached = statements.get(query);
    if (cached !== undefined) return cached;
    if (statements.size >= PREPARED_STATEMENTS) statements.clear();
    const created = db.prepare(query);
    statements.set(query, created);
    return created;
  };
  const all = (query: string, parameters: ReadonlyArray<unknown>) =>
    // SAFETY: parameters are strings and numbers, which node:sqlite accepts as bindings.
    prepare(query).all(...(parameters as Array<SQLInputValue>));
  const state = decodeState(
    all(
      `SELECT organizationId, activeGeneration AS generation, localCommitVersion AS version
         FROM replica_state WHERE id = 'singleton'`,
      [],
    )[0],
  );
  const organizationId = state.organizationId;
  const ids = (values: ReadonlyArray<string>) => JSON.stringify(values);
  return {
    organizationId,
    stamp: { generation: String(state.generation), version: state.version },
    productCount: () =>
      Number(
        all("SELECT count(*) AS n FROM products WHERE organizationId = ?", [organizationId])[0]?.[
          "n"
        ] ?? 0,
      ),
    productPage: (after, limit) =>
      decodeProducts(
        all(
          `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
            WHERE p.organizationId = ? AND p.visible = 1 AND p.id > ?
            ORDER BY p.id LIMIT ?`,
          [organizationId, after, limit],
        ),
      ).map(toProductFact),
    productsByIds: (values) =>
      decodeProducts(
        all(
          `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
            WHERE p.organizationId = ? AND p.visible = 1
              AND p.id IN (SELECT value FROM json_each(?))
            ORDER BY p.id`,
          [organizationId, ids(values)],
        ),
      ).map(toProductFact),
    batchesBetween: (firstId, lastId) =>
      decodeBatches(
        all(
          batchesBetweenStatement.sql,
          batchesBetweenStatement.params.map((param) =>
            param === FIRST
              ? firstId
              : param === LAST
                ? lastId
                : param === ORGANIZATION
                  ? organizationId
                  : param,
          ),
        ),
      ),
    batchesForProducts: (values) =>
      decodeBatches(
        all(
          batchesForProductsStatement.sql,
          batchesForProductsStatement.params.map((param) =>
            param === FIRST ? ids(values) : param === ORGANIZATION ? organizationId : param,
          ),
        ),
      ),
    windowFacts: (window) => {
      const offset = window.utcOffsetMinutes * 60_000;
      const days = decodeDays(
        all(
          `SELECT (createdAt + cast(? as integer)) / ${INSIGHTS_DAY_MILLIS} AS day, count(*) AS invoices,
                  coalesce(sum(total), 0) AS revenue
             FROM invoices
            WHERE organizationId = ? AND createdAt >= ? AND createdAt < ?
            GROUP BY day ORDER BY day`,
          [offset, organizationId, window.since, window.until],
        ),
      );
      const hours = decodeHours(
        all(
          `SELECT ((createdAt + cast(? as integer)) % ${INSIGHTS_DAY_MILLIS}) / ${INSIGHTS_HOUR_MILLIS} AS hour,
                  count(*) AS invoices, coalesce(sum(total), 0) AS revenue
             FROM invoices
            WHERE organizationId = ? AND createdAt >= ? AND createdAt < ?
            GROUP BY hour ORDER BY hour`,
          [offset, organizationId, window.since, window.until],
        ),
      );
      return { days, hours };
    },
    sales: (range, productIds) => {
      const restrict =
        productIds === undefined ? "" : " AND ii.productId IN (SELECT value FROM json_each(?))";
      const bounds = [
        range.utcOffsetMinutes * 60_000,
        organizationId,
        insightsDayStart(range.firstDay, range.utcOffsetMinutes),
        insightsDayStart(range.lastDay + 1, range.utcOffsetMinutes),
      ];
      return decodeSales(
        all(
          `SELECT ii.productId AS productId,
                  CAST((i.createdAt + cast(? as integer)) / ${INSIGHTS_DAY_MILLIS} AS INTEGER) AS day,
                  sum(ii.baseUnitQuantity) AS units,
                  coalesce(sum(ii.quantity * ii.salePrice), 0) AS revenue
             FROM invoices i
            CROSS JOIN invoice_items ii ON ii.organizationId = i.organizationId AND ii.invoiceId = i.id
            CROSS JOIN products p ON p.organizationId = ii.organizationId AND p.id = ii.productId
            WHERE i.organizationId = ? AND p.visible = 1 AND i.createdAt >= ? AND i.createdAt < ?${restrict}
            GROUP BY ii.productId, day`,
          productIds === undefined ? bounds : [...bounds, ids(productIds)],
        ),
      );
    },
    resolveTouched: (keys, maxProducts) => {
      const grouped = new Map<string, Set<string>>();
      let unresolved = false;
      for (const key of keys) {
        const parts = keyParts(key);
        if (parts === undefined) {
          unresolved = true;
          continue;
        }
        const held = grouped.get(parts.entity) ?? new Set<string>();
        held.add(parts.id);
        grouped.set(parts.entity, held);
      }
      const productIds = new Set<string>();
      let overflow = false;
      const known = new Set<string>([
        "product",
        "batch",
        "invoice",
        "invoiceItem",
        "category",
        "stockMovement",
      ]);
      for (const [entity, held] of grouped) {
        if (!known.has(entity)) unresolved = true;
        const list = ids([...held]);
        switch (entity) {
          case "product":
            for (const id of held) productIds.add(id);
            break;
          case "batch": {
            const rows = decodeProductIds(
              all(
                `SELECT id, productId FROM batches
                  WHERE organizationId = ? AND id IN (SELECT value FROM json_each(?))`,
                [organizationId, list],
              ),
            );
            if (rows.length < held.size) unresolved = true;
            for (const row of rows) productIds.add(row.productId);
            break;
          }
          case "invoice": {
            const found = decodeIds(
              all(
                `SELECT id FROM invoices
                  WHERE organizationId = ? AND id IN (SELECT value FROM json_each(?))`,
                [organizationId, list],
              ),
            );
            if (found.length < held.size) unresolved = true;
            for (const row of decodeDistinctProducts(
              all(
                `SELECT DISTINCT productId FROM invoice_items
                  WHERE organizationId = ? AND invoiceId IN (SELECT value FROM json_each(?))`,
                [organizationId, list],
              ),
            )) {
              productIds.add(row.productId);
            }
            break;
          }
          case "invoiceItem": {
            const rows = decodeProductIds(
              all(
                `SELECT id, productId FROM invoice_items
                  WHERE organizationId = ? AND id IN (SELECT value FROM json_each(?))`,
                [organizationId, list],
              ),
            );
            if (rows.length < held.size) unresolved = true;
            for (const row of rows) productIds.add(row.productId);
            break;
          }
          case "category": {
            const rows = decodeIds(
              all(
                `SELECT id FROM products
                  WHERE organizationId = ? AND categoryId IN (SELECT value FROM json_each(?))
                  LIMIT ?`,
                [organizationId, list, maxProducts + 1],
              ),
            );
            if (rows.length > maxProducts) overflow = true;
            for (const row of rows) productIds.add(row.id);
            break;
          }
          default:
            break;
        }
      }
      return { productIds, unresolved, overflow };
    },
  };
};

export const openInventorySource = (
  path: string,
): Effect.Effect<InventorySource, AnalyticsFailure, Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const opened = new DatabaseSync(path, { readOnly: true });
          opened.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLIS}`);
          return opened;
        },
        catch: analyticsFailure,
      }),
      (opened) => Effect.sync(() => opened.close()).pipe(Effect.ignore),
    );
    const statements = new Map<string, StatementSync>();
    const turn = yield* Semaphore.make(1);
    return {
      snapshot: (work) =>
        turn.withPermits(1)(
          Effect.acquireUseRelease(
            Effect.try({
              try: () => {
                db.exec("BEGIN");
                try {
                  return makeSnapshot(db, statements);
                } catch (cause) {
                  db.exec("ROLLBACK");
                  throw cause;
                }
              },
              catch: analyticsFailure,
            }),
            work,
            () => Effect.sync(() => db.exec("ROLLBACK")).pipe(Effect.ignore),
          ),
        ),
    } satisfies InventorySource;
  });
