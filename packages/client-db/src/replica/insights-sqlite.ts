import {
  INSIGHTS_DAY_MILLIS,
  INSIGHTS_HOUR_MILLIS,
  MAX_INSIGHTS_BATCHES,
  MAX_INSIGHTS_PRODUCTS,
  MAX_INSIGHTS_SALES,
  type ReplicaInsightsFacts,
  type ReplicaInsightsWindow,
} from "@store/contracts";
import {
  categories,
  invoiceItems,
  invoices,
  products,
  replicaState,
} from "@store/db/replica.schema";
import type { ReplicaDb, SqliteReplicaHandle } from "@store/sync/sql-client";
import { and, count, eq, gte, lt, ne, or, sql, sum } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { visibleBatches } from "./compile";

const Flag = Schema.Number;

const ProductFactRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  categoryId: Schema.String,
  categoryName: Schema.NullOr(Schema.String),
  tracksPacks: Flag,
  unitsPerPack: Schema.Number,
  purchasePrice: Schema.NullOr(Schema.Number),
  retailPrice: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
  visible: Flag,
  createdAt: Schema.Number,
});

const BatchFactRow = Schema.Struct({
  productId: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number),
});

const SaleFactRow = Schema.Struct({
  productId: Schema.String,
  day: Schema.Number,
  units: Schema.Number,
  revenue: Schema.Number,
});

const DayFactRow = Schema.Struct({
  day: Schema.Number,
  invoices: Schema.Number,
  revenue: Schema.Number,
});

const HourFactRow = Schema.Struct({
  hour: Schema.Number,
  invoices: Schema.Number,
  revenue: Schema.Number,
});

const utcOffset = (offset: number) => sql`cast(${offset} as integer)`;

const currentOrganization = (db: ReplicaDb) =>
  db
    .select({ organizationId: replicaState.organizationId })
    .from(replicaState)
    .where(eq(replicaState.id, "singleton"));

const productsQuery = (db: ReplicaDb, limit: number) =>
  db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      tracksPacks: sql<number>`coalesce(${categories.tracksPacks}, 1)`.as("tracksPacks"),
      unitsPerPack: sql<number>`max(${products.unitsPerPack}, 1)`.as("unitsPerPack"),
      purchasePrice: products.purchasePrice,
      retailPrice: products.retailPrice,
      unitPrice: products.unitPrice,
      visible: sql<number>`${products.visible}`.as("visible"),
      createdAt: products.createdAt,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(products.id)
    .limit(limit)
    .all();

const batchesQuery = (db: ReplicaDb, limit: number) =>
  db
    .with(visibleBatches)
    .select({
      productId: visibleBatches.productId,
      batchNumber: visibleBatches.batchNumber,
      packQuantity: visibleBatches.packQuantity,
      unitQuantity: visibleBatches.unitQuantity,
      expiresAt: visibleBatches.expiresAt,
    })
    .from(visibleBatches)
    .where(or(ne(visibleBatches.packQuantity, 0), ne(visibleBatches.unitQuantity, 0)))
    .orderBy(visibleBatches.productId, visibleBatches.expiresAt)
    .limit(limit)
    .all();

const salesQuery = (
  db: ReplicaDb,
  offset: number,
  window: ReplicaInsightsWindow,
  limit: number,
) => {
  const day =
    sql<number>`(${invoices.createdAt} + ${utcOffset(offset)}) / ${sql.raw(String(INSIGHTS_DAY_MILLIS))}`.as(
      "day",
    );
  return db
    .select({
      productId: invoiceItems.productId,
      day,
      units: sum(invoiceItems.baseUnitQuantity).mapWith(Number).as("units"),
      revenue:
        sql<number>`coalesce(sum(${invoiceItems.quantity} * ${invoiceItems.salePrice}), 0)`.as(
          "revenue",
        ),
    })
    .from(invoices)
    .innerJoin(
      invoiceItems,
      and(
        eq(invoiceItems.organizationId, invoices.organizationId),
        eq(invoiceItems.invoiceId, invoices.id),
      ),
    )
    .where(
      and(
        eq(invoices.organizationId, currentOrganization(db)),
        gte(invoices.createdAt, window.since),
        lt(invoices.createdAt, window.until),
      ),
    )
    .groupBy(invoiceItems.productId, day)
    .limit(limit)
    .all();
};

const windowedInvoices = (db: ReplicaDb, window: ReplicaInsightsWindow) =>
  and(
    eq(invoices.organizationId, currentOrganization(db)),
    gte(invoices.createdAt, window.since),
    lt(invoices.createdAt, window.until),
  );

const daysQuery = (db: ReplicaDb, offset: number, window: ReplicaInsightsWindow) => {
  const day =
    sql<number>`(${invoices.createdAt} + ${utcOffset(offset)}) / ${sql.raw(String(INSIGHTS_DAY_MILLIS))}`.as(
      "day",
    );
  return db
    .select({
      day,
      invoices: count().as("invoices"),
      revenue: sql<number>`coalesce(sum(${invoices.total}), 0)`.as("revenue"),
    })
    .from(invoices)
    .where(windowedInvoices(db, window))
    .groupBy(day)
    .orderBy(day)
    .all();
};

const hoursQuery = (db: ReplicaDb, offset: number, window: ReplicaInsightsWindow) => {
  const hour =
    sql<number>`((${invoices.createdAt} + ${utcOffset(offset)}) % ${sql.raw(String(INSIGHTS_DAY_MILLIS))}) / ${sql.raw(String(INSIGHTS_HOUR_MILLIS))}`.as(
      "hour",
    );
  return db
    .select({
      hour,
      invoices: count().as("invoices"),
      revenue: sql<number>`coalesce(sum(${invoices.total}), 0)`.as("revenue"),
    })
    .from(invoices)
    .where(windowedInvoices(db, window))
    .groupBy(hour)
    .orderBy(hour)
    .all();
};

const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  rows: ReadonlyArray<unknown>,
) => Schema.decodeUnknownEffect(Schema.Array(schema))(rows);

export const readSqliteInsightsFacts = Effect.fn("ReplicaNodeSqlite.readInsightsFacts")(function* (
  handle: SqliteReplicaHandle,
  window: ReplicaInsightsWindow,
) {
  const offset = window.utcOffsetMinutes * 60_000;
  const { db } = handle;
  const productRows = yield* productsQuery(db, MAX_INSIGHTS_PRODUCTS + 1);
  const batchRows = yield* batchesQuery(db, MAX_INSIGHTS_BATCHES + 1);
  const saleRows = yield* salesQuery(db, offset, window, MAX_INSIGHTS_SALES + 1);
  const dayRows = yield* daysQuery(db, offset, window);
  const hourRows = yield* hoursQuery(db, offset, window);
  const products = yield* decodeRows(ProductFactRow, productRows.slice(0, MAX_INSIGHTS_PRODUCTS));
  const batches = yield* decodeRows(BatchFactRow, batchRows.slice(0, MAX_INSIGHTS_BATCHES));
  const sales = yield* decodeRows(SaleFactRow, saleRows.slice(0, MAX_INSIGHTS_SALES));
  const days = yield* decodeRows(DayFactRow, dayRows);
  const hours = yield* decodeRows(HourFactRow, hourRows);
  const facts: ReplicaInsightsFacts = {
    window,
    products: products.map((row) => ({
      ...row,
      tracksPacks: row.tracksPacks !== 0,
      visible: row.visible !== 0,
    })),
    batches,
    sales,
    days,
    hours,
    truncated:
      productRows.length > MAX_INSIGHTS_PRODUCTS ||
      batchRows.length > MAX_INSIGHTS_BATCHES ||
      saleRows.length > MAX_INSIGHTS_SALES,
  };
  return facts;
});
