import { nextInvoiceNumber, OPEN_PURCHASE_ORDER_STATUSES, type SupplierId } from "@store/contracts";
import * as Effect from "effect/Effect";

import type { CatalogProjectionTables } from "./catalog-projection";
import type { PurchasingProjectionTables } from "./purchasing-projection";
import { drainSubset, type ReadSubset } from "./replica/collection-read";
import { decodeSourceRows } from "./replica/decode";
import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  MAX_BATCH_SPECS,
  MAX_IN_VALUES,
  type InventoryCollectionSource,
} from "./replica/sources";
import type { ReplicaRow } from "./replica/sqlite-row";
import type { InventorySubsetSpec, SubsetPredicate } from "./replica/subset-spec";
import type { CatalogRows, ReplicaSubsetReader } from "./replica/types";
import type { PurchaseOrderItemRow, PurchaseOrderRow } from "./rows";

const CONCURRENT = { concurrency: "unbounded" } as const;

const attempt = <A>(evaluate: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause });

const subsetReads =
  (reader: ReplicaSubsetReader): ReadSubset =>
  (spec) =>
    attempt(() => reader.readSubset(spec));

const NO_ROWS = Effect.succeed([]);

export type CatalogRowsRequest = {
  readonly allCategories?: boolean;
  readonly categoryIds?: Iterable<string>;
  readonly productIds?: Iterable<string>;
  readonly anyProductInCategory?: string;
  readonly batchIds?: Iterable<string>;
  readonly batchesOfProductIds?: Iterable<string>;
};

const readFirst = <Source extends InventoryCollectionSource>(
  read: ReadSubset,
  source: Source,
  where: SubsetPredicate,
  orderBy: InventorySubsetSpec["orderBy"],
): Effect.Effect<ReadonlyArray<CatalogRows[Source]>, unknown> =>
  read({ source, where, orderBy, limit: 1, offset: 0 }).pipe(
    Effect.flatMap((page) => decodeSourceRows(source)(page.rows)),
  );

const BY_ID: InventorySubsetSpec["orderBy"] = [{ column: "id", direction: "asc" }];

const readAll = <Source extends InventoryCollectionSource>(
  read: ReadSubset,
  source: Source,
  where?: SubsetPredicate,
): Effect.Effect<ReadonlyArray<CatalogRows[Source]>, unknown> =>
  drainSubset(read, source, where, DEFAULT_COLLECTION_MAXIMUM_ROWS).pipe(
    Effect.flatMap((drained) => decodeSourceRows(source)(drained.rows)),
  );

const inChunks = (column: string, values: Iterable<string> | undefined) => {
  const unique = [...new Set(values ?? [])];
  const predicates: Array<SubsetPredicate> = [];
  for (let start = 0; start < unique.length; start += MAX_IN_VALUES) {
    predicates.push({ _tag: "in", column, values: unique.slice(start, start + MAX_IN_VALUES) });
  }
  return predicates;
};

const readWhereIn = <Source extends InventoryCollectionSource>(
  read: ReadSubset,
  source: Source,
  column: string,
  values: Iterable<string> | undefined,
): Effect.Effect<ReadonlyArray<CatalogRows[Source]>, unknown> =>
  Effect.forEach(
    inChunks(column, values),
    (where) => readAll(read, source, where),
    CONCURRENT,
  ).pipe(Effect.map((chunks) => chunks.flat()));

const readable = <Row extends { readonly id: string }>(
  ...groups: ReadonlyArray<ReadonlyArray<Row>>
) => {
  const byId = new Map(groups.flat().map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => byId.get(id),
      values: () => byId.values(),
    },
  };
};

export const readCatalogRows = (
  reader: ReplicaSubsetReader,
  request: CatalogRowsRequest,
): Effect.Effect<CatalogProjectionTables, unknown> =>
  Effect.suspend(() => {
    const read = subsetReads(reader);
    return Effect.all(
      [
        request.allCategories ? readAll(read, "categories") : NO_ROWS,
        readWhereIn(read, "categories", "id", request.categoryIds),
        readWhereIn(read, "products", "id", request.productIds),
        request.anyProductInCategory === undefined
          ? NO_ROWS
          : readFirst(
              read,
              "products",
              {
                _tag: "compare",
                column: "categoryId",
                op: "eq",
                value: request.anyProductInCategory,
              },
              BY_ID,
            ),
        readWhereIn(read, "batches", "id", request.batchIds),
        readWhereIn(read, "batches", "productId", request.batchesOfProductIds),
      ],
      CONCURRENT,
    );
  }).pipe(
    Effect.map(
      ([allCategories, categories, products, categoryProducts, batches, productBatches]) => ({
        categories: readable(allCategories, categories),
        products: readable(products, categoryProducts),
        batches: readable(batches, productBatches),
      }),
    ),
  );

const readLatest = <Source extends "invoices" | "purchaseOrders">(
  reader: ReplicaSubsetReader,
  source: Source,
  column: string,
  organizationId: string,
): Effect.Effect<ReadonlyArray<CatalogRows[Source]>, unknown> =>
  readFirst(
    subsetReads(reader),
    source,
    { _tag: "compare", column: "organizationId", op: "eq", value: organizationId },
    [{ column, direction: "desc" }],
  );

export const readNextInvoiceNumber = (
  reader: ReplicaSubsetReader,
  organizationId: string,
): Effect.Effect<number, unknown> =>
  readLatest(reader, "invoices", "invoiceNumber", organizationId).pipe(
    Effect.map((latest) => nextInvoiceNumber(latest.map((invoice) => invoice.invoiceNumber))),
  );

export type PurchasingRowsRequest = {
  readonly allSuppliers?: boolean;
  readonly supplierIds?: Iterable<string>;
  readonly orderIds?: Iterable<string>;
  readonly anyOrderOfSupplier?: string;
  readonly itemsOfOrderIds?: Iterable<string>;
  readonly productIds?: Iterable<string>;
  readonly productsOfItems?: boolean;
};

export const readPurchasingRows = Effect.fnUntraced(function* (
  reader: ReplicaSubsetReader,
  request: PurchasingRowsRequest,
): Effect.fn.Return<PurchasingProjectionTables, unknown> {
  const read = subsetReads(reader);
  const [allSuppliers, suppliers, orders, supplierOrders, items] = yield* Effect.all(
    [
      request.allSuppliers ? readAll(read, "suppliers") : NO_ROWS,
      readWhereIn(read, "suppliers", "id", request.supplierIds),
      readWhereIn(read, "purchaseOrders", "id", request.orderIds),
      request.anyOrderOfSupplier === undefined
        ? NO_ROWS
        : readFirst(
            read,
            "purchaseOrders",
            {
              _tag: "compare",
              column: "supplierId",
              op: "eq",
              value: request.anyOrderOfSupplier,
            },
            BY_ID,
          ),
      readWhereIn(read, "purchaseOrderItems", "purchaseOrderId", request.itemsOfOrderIds),
    ],
    CONCURRENT,
  );
  const products = yield* readWhereIn(read, "products", "id", [
    ...(request.productIds ?? []),
    ...(request.productsOfItems ? items.map((item) => item.productId) : []),
  ]);
  return {
    suppliers: readable(allSuppliers, suppliers),
    purchaseOrders: readable(orders, supplierOrders),
    purchaseOrderItems: readable(items),
    products: readable(products),
  };
});

export const readNextPurchaseOrderNumber = (
  reader: ReplicaSubsetReader,
  organizationId: string,
): Effect.Effect<number, unknown> =>
  readLatest(reader, "purchaseOrders", "orderNumber", organizationId).pipe(
    Effect.map((latest) => nextInvoiceNumber(latest.map((order) => order.orderNumber))),
  );

export type OpenOrderLines = {
  readonly orders: ReadonlyArray<PurchaseOrderRow>;
  readonly lines: ReadonlyArray<PurchaseOrderItemRow>;
};

export const readOpenOrderLines = Effect.fnUntraced(function* (
  reader: ReplicaSubsetReader,
  productIds: Iterable<string>,
): Effect.fn.Return<OpenOrderLines, unknown> {
  const products = inChunks("productId", productIds);
  if (products.length === 0) return { orders: [], lines: [] };
  const read = subsetReads(reader);
  const orders = yield* readAll(read, "purchaseOrders", {
    _tag: "in",
    column: "status",
    values: OPEN_PURCHASE_ORDER_STATUSES,
  });
  const lines = yield* Effect.forEach(
    inChunks(
      "purchaseOrderId",
      orders.map((order) => order.id),
    ).flatMap((ofOrders) =>
      products.map((ofProducts): SubsetPredicate => ({
        _tag: "and",
        predicates: [ofProducts, ofOrders],
      })),
    ),
    (where) => readAll(read, "purchaseOrderItems", where),
    CONCURRENT,
  );
  return { orders, lines: lines.flat() };
});

const latestLineSpec = (productId: string): InventorySubsetSpec => ({
  source: "purchaseOrderItems",
  where: { _tag: "compare", column: "productId", op: "eq", value: productId },
  orderBy: [
    { column: "createdAt", direction: "desc" },
    { column: "id", direction: "desc" },
  ],
  limit: 1,
  offset: 0,
});

const specBatches = (specs: ReadonlyArray<InventorySubsetSpec>) => {
  const batches: Array<ReadonlyArray<InventorySubsetSpec>> = [];
  for (let start = 0; start < specs.length; start += MAX_BATCH_SPECS) {
    batches.push(specs.slice(start, start + MAX_BATCH_SPECS));
  }
  return batches;
};

const readSpecs = (
  reader: ReplicaSubsetReader,
  specs: ReadonlyArray<InventorySubsetSpec>,
): Effect.Effect<ReadonlyArray<ReplicaRow>, unknown> => {
  const readBatch = reader.readBatch;
  return readBatch === undefined
    ? Effect.forEach(specs, subsetReads(reader), CONCURRENT).pipe(
        Effect.map((reads) => reads.flatMap((read) => read.rows)),
      )
    : Effect.forEach(
        specBatches(specs),
        (batch) => attempt(() => readBatch.call(reader, batch)),
        CONCURRENT,
      ).pipe(Effect.map((batches) => batches.flatMap((batch) => batch.reads.flat())));
};

export const readLearnedSuppliers = Effect.fnUntraced(function* (
  reader: ReplicaSubsetReader,
  productIds: Iterable<string>,
): Effect.fn.Return<ReadonlyMap<string, SupplierId>, unknown> {
  const rows = yield* readSpecs(reader, [...new Set(productIds)].map(latestLineSpec));
  const lines = yield* decodeSourceRows("purchaseOrderItems")(rows);
  const orders = yield* readWhereIn(
    subsetReads(reader),
    "purchaseOrders",
    "id",
    lines.map((line) => line.purchaseOrderId),
  );
  const supplierOf = new Map(orders.map((order) => [order.id, order.supplierId]));
  const learned = new Map<string, SupplierId>();
  for (const line of lines) {
    const supplierId = supplierOf.get(line.purchaseOrderId);
    if (supplierId !== undefined) learned.set(line.productId, supplierId);
  }
  return learned;
});
