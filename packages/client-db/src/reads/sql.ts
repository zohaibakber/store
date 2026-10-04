import { OPEN_PURCHASE_ORDER_STATUSES, type PurchaseOrderStatus } from "@store/contracts";
import {
  ReplicaStorageError,
  type HistoryCursor,
  type InvoiceListFilters,
  type InvoiceSortColumn,
  type ProductFacetColumn,
  type ProductListFilters,
  type ProductSortColumn,
  type PurchaseOrderListFilters,
  type PurchaseOrderSortColumn,
  type PurchaseOrderTab,
  type SortDirection,
  type Stamp,
} from "@store/contracts/replica";
import {
  categories,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
} from "@store/db/replica.schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  like,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/sql/SqlClient";

import { toStatement, visibleBatches } from "../replica/compile";
import { decodeSourceRows } from "../replica/decode";
import {
  currentOrganization,
  inJsonList,
  replicaQueryBuilder,
  replicaStampQuery,
} from "../replica/replica-queries";
import { MAX_DISTINCT_VALUES, type InventoryCollectionSource } from "../replica/sources";
import type { ReplicaRow } from "../replica/sqlite-row";
import { readFailure } from "../store/failures";
import { searchTokens } from "./search";

type Query = Parameters<typeof toStatement>[0];

type Window = { readonly limit: number; readonly offset?: number };

const RELATIONS = {
  categories,
  products,
  batches: visibleBatches,
  invoices,
  invoiceItems,
  stockMovements,
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
};

const scopedTo = (source: InventoryCollectionSource, where: SQL | undefined) =>
  and(eq(RELATIONS[source].organizationId, currentOrganization), where);

const selectRows = (
  source: InventoryCollectionSource,
  where: SQL | undefined,
  order: ReadonlyArray<SQL>,
  window: Window | undefined,
): Query => {
  const ordered = replicaQueryBuilder
    .with(...(source === "batches" ? [visibleBatches] : []))
    .select()
    .from(RELATIONS[source])
    .where(scopedTo(source, where))
    .orderBy(...order);
  return window === undefined ? ordered : ordered.limit(window.limit).offset(window.offset ?? 0);
};

const countRows = (source: Exclude<InventoryCollectionSource, "batches">, where: SQL | undefined) =>
  replicaQueryBuilder
    .select({ count: count().as("count") })
    .from(RELATIONS[source])
    .where(scopedTo(source, where));

const StampRow = Schema.Struct({ generation: Schema.Number, version: Schema.Number });
const CountRow = Schema.Struct({ count: Schema.Number });
const ValueRow = Schema.Struct({ value: Schema.String });

export const makeReplicaReads = (client: SqlClient) => {
  const run = (query: Query) =>
    Effect.suspend(() => {
      const statement = toStatement(query);
      return client.unsafe<ReplicaRow>(statement.sql, statement.parameters);
    });

  const decoded = <A>(row: Schema.Decoder<A>) => {
    const decode = Schema.decodeUnknownEffect(Schema.Array(row));
    return (query: Query) => run(query).pipe(Effect.flatMap(decode));
  };

  const stampRows = decoded(StampRow);
  const countOf = decoded(CountRow);
  const valuesOf = decoded(ValueRow);

  const stamp = Effect.gen(function* () {
    const [state] = yield* stampRows(replicaStampQuery);
    if (state === undefined) {
      return yield* new ReplicaStorageError({ message: "Replica storage has no replica state." });
    }
    return {
      generationId: String(state.generation),
      localCommitVersion: state.version,
    } satisfies Stamp;
  });

  return {
    snapshot: <A extends object, E>(read: Effect.Effect<A, E>) =>
      client
        .withTransaction(
          Effect.gen(function* () {
            const at = yield* stamp;
            return { stamp: at, ...(yield* read) };
          }),
        )
        .pipe(Effect.mapError(readFailure)),
    rows: <Source extends InventoryCollectionSource>(
      source: Source,
      where: SQL | undefined,
      order: ReadonlyArray<SQL>,
      window?: Window,
    ) =>
      run(selectRows(source, where, order, window)).pipe(Effect.flatMap(decodeSourceRows(source))),
    decoded,
    counted: (source: Exclude<InventoryCollectionSource, "batches">, where?: SQL) =>
      countOf(countRows(source, where)).pipe(Effect.map((counts) => counts[0]?.count ?? 0)),
    facetValues: (column: ProductFacetColumn, where: SQL | undefined) => {
      const target = PRODUCT_FACETS[column];
      return valuesOf(
        replicaQueryBuilder
          .select({ value: sql<string>`min(trim(${target}))`.as("value") })
          .from(products)
          .where(scopedTo("products", and(where, isNotNull(target), sql`trim(${target}) <> ''`)))
          .groupBy(sql`lower(trim(${target}))`)
          .orderBy(sql`value COLLATE NOCASE`)
          .limit(MAX_DISTINCT_VALUES),
      ).pipe(Effect.map((values) => values.map((entry) => entry.value)));
    },
  };
};

export const among = (column: SQLiteColumn, values: ReadonlyArray<string>) =>
  inJsonList(column, sql`${JSON.stringify(values)}`);

const sorted = (target: SQLWrapper, id: SQLiteColumn, direction: SortDirection) =>
  direction === "desc" ? [desc(target), desc(id)] : [asc(target), asc(id)];

const PRODUCT_NAME = sql`${products.name} COLLATE NOCASE`;

const PRODUCT_ORDER = {
  name: PRODUCT_NAME,
  aisle: sql`${products.aisle} COLLATE NOCASE`,
  unitsPerPack: products.unitsPerPack,
  purchasePrice: products.purchasePrice,
  retailPrice: products.retailPrice,
  unitPrice: products.unitPrice,
  updatedAt: products.updatedAt,
} satisfies Record<ProductSortColumn, SQLWrapper>;

const INVOICE_ORDER = {
  createdAt: invoices.createdAt,
  invoiceNumber: invoices.invoiceNumber,
} satisfies Record<InvoiceSortColumn, SQLiteColumn>;

const PURCHASE_ORDER_ORDER = {
  createdAt: purchaseOrders.createdAt,
  orderNumber: purchaseOrders.orderNumber,
} satisfies Record<PurchaseOrderSortColumn, SQLiteColumn>;

const PRODUCT_FACETS = {
  categoryId: products.categoryId,
  name: products.name,
  aisle: products.aisle,
  composition: products.composition,
  strength: products.strength,
} satisfies Record<ProductFacetColumn, SQLiteColumn>;

type Sort<Column> = { readonly column: Column; readonly direction: SortDirection };

export const productOrder = (sort: Sort<ProductSortColumn>) =>
  sorted(PRODUCT_ORDER[sort.column], products.id, sort.direction);

export const invoiceOrder = (sort: Sort<InvoiceSortColumn>) =>
  sorted(INVOICE_ORDER[sort.column], invoices.id, sort.direction);

export const purchaseOrderOrder = (sort: Sort<PurchaseOrderSortColumn>) =>
  sorted(PURCHASE_ORDER_ORDER[sort.column], purchaseOrders.id, sort.direction);

export const PRODUCTS_BY_NAME = [asc(PRODUCT_NAME), asc(products.id)];

type Dated = { readonly createdAt: SQLiteColumn; readonly id: SQLiteColumn };

export const newestFirst = (table: Dated) => [desc(table.createdAt), desc(table.id)];

export const olderThan = (table: Dated, before: HistoryCursor | undefined) =>
  before === undefined
    ? undefined
    : or(
        lt(table.createdAt, before.createdAt),
        and(eq(table.createdAt, before.createdAt), lt(table.id, before.id)),
      );

const SEARCH_COLUMNS = [products.name, products.composition, products.strength];

const SEARCH_INDEX = sql.identifier("products_search");

const SEARCH_INDEX_COLUMNS = "{name composition strength}";

const MIN_TRIGRAM_CHARACTERS = 3;

const WILDCARD = /[%_]/u;

const containsToken = (token: string): SQL | undefined => {
  const anywhere = or(...SEARCH_COLUMNS.map((column) => like(column, `%${token}%`)));
  if (WILDCARD.test(token) || Array.from(token).length < MIN_TRIGRAM_CHARACTERS) return anywhere;
  const match = `${SEARCH_INDEX_COLUMNS} : "${token.replaceAll('"', '""')}"`;
  return sql`(${products}.rowid in (select rowid from ${SEARCH_INDEX} where ${SEARCH_INDEX} match ${match}) and ${anywhere})`;
};

export const containsEvery = (tokens: ReadonlyArray<string>) => and(...tokens.map(containsToken));

export const nameStartsWith = (tokens: ReadonlyArray<string>) =>
  like(products.name, `${tokens.join(" ")}%`);

export const nameIs = (name: string) => like(products.name, name);

export const productWhere = (filters: ProductListFilters) =>
  and(
    containsEvery(searchTokens(filters.search ?? "")),
    filters.categoryId ? eq(products.categoryId, filters.categoryId) : undefined,
    filters.aisle ? like(products.aisle, filters.aisle) : undefined,
    filters.composition ? like(products.composition, filters.composition) : undefined,
    filters.strength ? like(products.strength, filters.strength) : undefined,
  );

const LIKE_ESCAPE = "\\";

const LIKE_WILDCARDS = /[%_\\]/gu;

export const invoiceWhere = (filters: InvoiceListFilters) => {
  const customer = (filters.customer ?? "").trim();
  if (customer === "") return undefined;
  const pattern = `%${customer.replace(LIKE_WILDCARDS, (wildcard) => `${LIKE_ESCAPE}${wildcard}`)}%`;
  return sql`${invoices.customerName} like ${pattern} escape ${LIKE_ESCAPE}`;
};

const TAB_STATUSES = {
  open: ["sent"],
  drafts: ["draft"],
  closed: ["closed", "cancelled"],
} satisfies Record<PurchaseOrderTab, ReadonlyArray<PurchaseOrderStatus>>;

const statusIn = (statuses: ReadonlyArray<PurchaseOrderStatus>) =>
  inArray(purchaseOrders.status, [...statuses]);

export const OPEN_ORDERS = statusIn(OPEN_PURCHASE_ORDER_STATUSES);

export const purchaseOrderWhere = (filters: PurchaseOrderListFilters) =>
  and(
    statusIn(TAB_STATUSES[filters.tab]),
    filters.supplierIds === undefined
      ? undefined
      : among(purchaseOrders.supplierId, filters.supplierIds),
  );

const openOrderIds = replicaQueryBuilder
  .select({ id: purchaseOrders.id })
  .from(purchaseOrders)
  .where(scopedTo("purchaseOrders", OPEN_ORDERS));

export const openLinesOf = (productIds: ReadonlyArray<string>) =>
  and(
    among(purchaseOrderItems.productId, productIds),
    inArray(purchaseOrderItems.purchaseOrderId, openOrderIds),
  );

export const openOrdersOf = (productIds: ReadonlyArray<string>) =>
  and(
    OPEN_ORDERS,
    inArray(
      purchaseOrders.id,
      replicaQueryBuilder
        .select({ id: purchaseOrderItems.purchaseOrderId })
        .from(purchaseOrderItems)
        .where(scopedTo("purchaseOrderItems", among(purchaseOrderItems.productId, productIds))),
    ),
  );

export const learnedSuppliersOf = (productIds: ReadonlyArray<string>) => {
  const latest = replicaQueryBuilder
    .select({
      productId: purchaseOrderItems.productId,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      recency:
        sql<number>`row_number() over (partition by ${purchaseOrderItems.productId} order by ${purchaseOrderItems.createdAt} desc, ${purchaseOrderItems.id} desc)`.as(
          "recency",
        ),
    })
    .from(purchaseOrderItems)
    .where(scopedTo("purchaseOrderItems", among(purchaseOrderItems.productId, productIds)))
    .as("latest");
  return replicaQueryBuilder
    .select({ productId: latest.productId, supplierId: purchaseOrders.supplierId })
    .from(latest)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, latest.purchaseOrderId))
    .where(and(eq(latest.recency, 1), scopedTo("purchaseOrders", undefined)))
    .orderBy(asc(latest.productId));
};

export const issuedInvoicesOf = (invoiceIds: ReadonlyArray<string>) =>
  replicaQueryBuilder
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(scopedTo("invoices", among(invoices.id, invoiceIds)))
    .orderBy(asc(invoices.id));
