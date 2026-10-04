import { nextInvoiceNumber } from "@store/contracts";
import * as Effect from "effect/Effect";

import type { CatalogProjectionTables } from "./catalog-projection";
import type { PurchasingProjectionTables } from "./purchasing-projection";
import { drainSubset, type ReadSubset } from "./replica/collection-read";
import { decodeSourceRows } from "./replica/decode";
import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  MAX_IN_VALUES,
  type InventoryCollectionSource,
} from "./replica/sources";
import type { InventorySubsetSpec, SubsetPredicate } from "./replica/subset-spec";
import type { CatalogRows } from "./replica/types";

const CONCURRENT = { concurrency: "unbounded" } as const;

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
  read: ReadSubset,
  request: CatalogRowsRequest,
): Effect.Effect<CatalogProjectionTables, unknown> =>
  Effect.suspend(() =>
    Effect.all(
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
    ),
  ).pipe(
    Effect.map(
      ([allCategories, categories, products, categoryProducts, batches, productBatches]) => ({
        categories: readable(allCategories, categories),
        products: readable(products, categoryProducts),
        batches: readable(batches, productBatches),
      }),
    ),
  );

const readLatest = <Source extends "invoices" | "purchaseOrders">(
  read: ReadSubset,
  source: Source,
  column: string,
  organizationId: string,
): Effect.Effect<ReadonlyArray<CatalogRows[Source]>, unknown> =>
  readFirst(
    read,
    source,
    { _tag: "compare", column: "organizationId", op: "eq", value: organizationId },
    [{ column, direction: "desc" }],
  );

export const readNextInvoiceNumber = (
  read: ReadSubset,
  organizationId: string,
): Effect.Effect<number, unknown> =>
  readLatest(read, "invoices", "invoiceNumber", organizationId).pipe(
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
  read: ReadSubset,
  request: PurchasingRowsRequest,
): Effect.fn.Return<PurchasingProjectionTables, unknown> {
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
  read: ReadSubset,
  organizationId: string,
): Effect.Effect<number, unknown> =>
  readLatest(read, "purchaseOrders", "orderNumber", organizationId).pipe(
    Effect.map((latest) => nextInvoiceNumber(latest.map((order) => order.orderNumber))),
  );
