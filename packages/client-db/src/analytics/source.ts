import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import {
  insightsDayStart,
  MAX_INSIGHTS_ON_ORDER,
  type InsightsBatchFact,
  type InsightsOnOrderFact,
  type InsightsProductFact,
  type ReplicaInsightsWindow,
} from "@store/contracts";
import {
  batches,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
} from "@store/db/replica.schema";
import { and, count, eq, exists, fillPlaceholders, gt, gte, lte, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import { visibleBatches } from "../replica/compile";
import {
  BatchFactRow,
  batchFacts,
  DayFactRow,
  HourFactRow,
  inJsonList,
  invoiceDays,
  invoiceHours,
  OnOrderFactRow,
  onOrderFacts,
  productDaySales,
  ProductFactRow,
  productFacts,
  replicaQueryBuilder,
  replicaStampQuery,
  SaleFactRow,
  toProductFact,
  type InvoiceWindow,
} from "../replica/replica-queries";
import { analyticsFailure, type AnalyticsFailure } from "./errors";
import type { SalesRow } from "./store";

const BUSY_TIMEOUT_MILLIS = 5_000;
const PREPARED_STATEMENTS = 64;

export type InventoryStamp = { readonly generation: string; readonly version: number };

type DayFact = typeof DayFactRow.Type;
type HourFact = typeof HourFactRow.Type;

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
  readonly onOrder: () => ReadonlyArray<InsightsOnOrderFact>;
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

type Statement = { readonly sql: string; readonly params: Array<unknown> };

const statement = (query: { toSQL: () => Statement }): Statement => query.toSQL();

const organization = sql.placeholder("organization");
const list = sql.placeholder("ids");

const invoiceWindow: InvoiceWindow = {
  organization,
  offset: sql.placeholder("offset"),
  since: sql.placeholder("since"),
  until: sql.placeholder("until"),
};

const orderedProductIsVisible = exists(
  replicaQueryBuilder
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.organizationId, purchaseOrderItems.organizationId),
        eq(products.id, purchaseOrderItems.productId),
        eq(products.visible, true),
      ),
    ),
);

const statements = {
  stamp: statement(replicaStampQuery),
  productCount: statement(
    replicaQueryBuilder
      .select({ n: count().as("n") })
      .from(products)
      .where(eq(products.organizationId, organization)),
  ),
  productPage: statement(
    productFacts({
      organization,
      visibleOnly: true,
      where: gt(products.id, sql.placeholder("after")),
    }).limit(sql.placeholder("limit")),
  ),
  productsByIds: statement(
    productFacts({ organization, visibleOnly: true, where: inJsonList(products.id, list) }),
  ),
  batchesBetween: statement(
    batchFacts({
      organization,
      where: and(
        gte(visibleBatches.productId, sql.placeholder("first")),
        lte(visibleBatches.productId, sql.placeholder("last")),
      ),
    }),
  ),
  batchesForProducts: statement(
    batchFacts({ organization, where: inJsonList(visibleBatches.productId, list) }),
  ),
  onOrder: statement(
    onOrderFacts({ organization, where: orderedProductIsVisible }).limit(MAX_INSIGHTS_ON_ORDER),
  ),
  days: statement(invoiceDays(invoiceWindow)),
  hours: statement(invoiceHours(invoiceWindow)),
  sales: statement(productDaySales({ ...invoiceWindow, visibleOnly: true })),
  salesForProducts: statement(
    productDaySales({
      ...invoiceWindow,
      visibleOnly: true,
      where: inJsonList(invoiceItems.productId, list),
    }),
  ),
  batchProducts: statement(
    replicaQueryBuilder
      .select({ id: batches.id, productId: batches.productId })
      .from(batches)
      .where(and(eq(batches.organizationId, organization), inJsonList(batches.id, list))),
  ),
  invoiceIds: statement(
    replicaQueryBuilder
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.organizationId, organization), inJsonList(invoices.id, list))),
  ),
  invoiceProducts: statement(
    replicaQueryBuilder
      .selectDistinct({ productId: invoiceItems.productId })
      .from(invoiceItems)
      .where(
        and(
          eq(invoiceItems.organizationId, organization),
          inJsonList(invoiceItems.invoiceId, list),
        ),
      ),
  ),
  invoiceItemProducts: statement(
    replicaQueryBuilder
      .select({ id: invoiceItems.id, productId: invoiceItems.productId })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.organizationId, organization), inJsonList(invoiceItems.id, list))),
  ),
  categoryProducts: statement(
    replicaQueryBuilder
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.organizationId, organization), inJsonList(products.categoryId, list)))
      .limit(sql.placeholder("limit")),
  ),
};

const decodeProducts = Schema.decodeUnknownSync(Schema.Array(ProductFactRow));
const decodeBatches = Schema.decodeUnknownSync(Schema.Array(BatchFactRow));
const decodeOnOrder = Schema.decodeUnknownSync(Schema.Array(OnOrderFactRow));
const decodeSales = Schema.decodeUnknownSync(Schema.Array(SaleFactRow));
const decodeDays = Schema.decodeUnknownSync(Schema.Array(DayFactRow));
const decodeHours = Schema.decodeUnknownSync(Schema.Array(HourFactRow));

const StateRow = Schema.Struct({
  organizationId: Schema.String,
  generation: Schema.Number,
  version: Schema.Number,
});
const decodeState = Schema.decodeUnknownSync(StateRow);

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

const makeSnapshot = (
  db: DatabaseSync,
  prepared: Map<string, StatementSync>,
): InventorySnapshot => {
  const prepare = (query: string) => {
    const cached = prepared.get(query);
    if (cached !== undefined) return cached;
    if (prepared.size >= PREPARED_STATEMENTS) prepared.clear();
    const created = db.prepare(query);
    prepared.set(query, created);
    return created;
  };
  const all = (query: Statement, values: Record<string, string | number> = {}) =>
    // SAFETY: placeholders are filled with strings and numbers, which node:sqlite accepts as bindings.
    prepare(query.sql).all(...(fillPlaceholders(query.params, values) as Array<SQLInputValue>));
  const state = decodeState(all(statements.stamp)[0]);
  const organizationId = state.organizationId;
  const ids = (values: ReadonlyArray<string>) => JSON.stringify(values);
  return {
    organizationId,
    stamp: { generation: String(state.generation), version: state.version },
    productCount: () =>
      Number(all(statements.productCount, { organization: organizationId })[0]?.["n"] ?? 0),
    productPage: (after, limit) =>
      decodeProducts(
        all(statements.productPage, { organization: organizationId, after, limit }),
      ).map(toProductFact),
    productsByIds: (values) =>
      decodeProducts(
        all(statements.productsByIds, { organization: organizationId, ids: ids(values) }),
      ).map(toProductFact),
    batchesBetween: (first, last) =>
      decodeBatches(all(statements.batchesBetween, { organization: organizationId, first, last })),
    batchesForProducts: (values) =>
      decodeBatches(
        all(statements.batchesForProducts, { organization: organizationId, ids: ids(values) }),
      ),
    onOrder: () => decodeOnOrder(all(statements.onOrder, { organization: organizationId })),
    windowFacts: (window) => {
      const bounds = {
        organization: organizationId,
        offset: window.utcOffsetMinutes * 60_000,
        since: window.since,
        until: window.until,
      };
      return {
        days: decodeDays(all(statements.days, bounds)),
        hours: decodeHours(all(statements.hours, bounds)),
      };
    },
    sales: (range, productIds) => {
      const bounds = {
        organization: organizationId,
        offset: range.utcOffsetMinutes * 60_000,
        since: insightsDayStart(range.firstDay, range.utcOffsetMinutes),
        until: insightsDayStart(range.lastDay + 1, range.utcOffsetMinutes),
      };
      return decodeSales(
        productIds === undefined
          ? all(statements.sales, bounds)
          : all(statements.salesForProducts, { ...bounds, ids: ids(productIds) }),
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
        "purchaseOrder",
        "purchaseOrderItem",
      ]);
      for (const [entity, held] of grouped) {
        if (!known.has(entity)) unresolved = true;
        const scope = { organization: organizationId, ids: ids([...held]) };
        switch (entity) {
          case "product":
            for (const id of held) productIds.add(id);
            break;
          case "batch": {
            const rows = decodeProductIds(all(statements.batchProducts, scope));
            if (rows.length < held.size) unresolved = true;
            for (const row of rows) productIds.add(row.productId);
            break;
          }
          case "invoice": {
            const found = decodeIds(all(statements.invoiceIds, scope));
            if (found.length < held.size) unresolved = true;
            for (const row of decodeDistinctProducts(all(statements.invoiceProducts, scope))) {
              productIds.add(row.productId);
            }
            break;
          }
          case "invoiceItem": {
            const rows = decodeProductIds(all(statements.invoiceItemProducts, scope));
            if (rows.length < held.size) unresolved = true;
            for (const row of rows) productIds.add(row.productId);
            break;
          }
          case "category": {
            const rows = decodeIds(
              all(statements.categoryProducts, { ...scope, limit: maxProducts + 1 }),
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
        try: () => new DatabaseSync(path, { readOnly: true }),
        catch: analyticsFailure,
      }),
      (opened) => Effect.try(() => opened.close()).pipe(Effect.ignore),
    );
    yield* Effect.try({
      try: () => db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLIS}`),
      catch: analyticsFailure,
    });
    const prepared = new Map<string, StatementSync>();
    const turn = yield* Semaphore.make(1);
    return {
      snapshot: (work) =>
        turn.withPermits(1)(
          Effect.acquireUseRelease(
            Effect.try({
              try: () => {
                db.exec("BEGIN");
                try {
                  return makeSnapshot(db, prepared);
                } catch (cause) {
                  db.exec("ROLLBACK");
                  throw cause;
                }
              },
              catch: analyticsFailure,
            }),
            work,
            () => Effect.try(() => db.exec("ROLLBACK")).pipe(Effect.ignore),
          ),
        ),
    } satisfies InventorySource;
  });
