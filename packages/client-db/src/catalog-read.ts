import { nextInvoiceNumber, OPEN_PURCHASE_ORDER_STATUSES, type SupplierId } from "@store/contracts";
import * as Effect from "effect/Effect";

import type { CatalogProjectionTables } from "./catalog-projection";
import type { PurchasingProjectionTables } from "./purchasing-projection";
import { drainSubset } from "./replica/collection-read";
import {
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodePurchaseOrderItemSqliteRows,
  decodePurchaseOrderSqliteRows,
  decodeSupplierSqliteRows,
} from "./replica/decode";
import type { ReplicaRowInvalid } from "./replica/errors";
import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  MAX_BATCH_SPECS,
  MAX_IN_VALUES,
  type InventoryCollectionSource,
} from "./replica/sources";
import type { ReplicaRow } from "./replica/sqlite-row";
import type { InventorySubsetSpec, SubsetPredicate } from "./replica/subset-spec";
import type { ReplicaSubsetReader } from "./replica/types";
import type {
  BatchRow,
  CategoryRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  SupplierRow,
} from "./rows";

type DecodeRows<Row> = (
  rows: ReadonlyArray<ReplicaRow>,
) => Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid>;

export type CatalogRowsRequest = {
  readonly allCategories?: boolean;
  readonly categoryIds?: Iterable<string>;
  readonly productIds?: Iterable<string>;
  readonly anyProductInCategory?: string;
  readonly batchIds?: Iterable<string>;
  readonly batchesOfProductIds?: Iterable<string>;
};

const readPage = async <Row>(
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  decode: DecodeRows<Row>,
  where: SubsetPredicate,
  limit: number,
) => {
  const read = await reader.readSubset({
    source,
    where,
    orderBy: [{ column: "id", direction: "asc" }],
    limit,
    offset: 0,
  });
  return Effect.runPromise(decode(read.rows));
};

const readAll = async <Row>(
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  decode: DecodeRows<Row>,
  where?: SubsetPredicate,
): Promise<ReadonlyArray<Row>> => {
  const read = await drainSubset(reader, source, where, DEFAULT_COLLECTION_MAXIMUM_ROWS);
  return Effect.runPromise(decode(read.rows));
};

const inChunks = (column: string, values: Iterable<string> | undefined) => {
  const unique = [...new Set(values ?? [])];
  const predicates: Array<SubsetPredicate> = [];
  for (let start = 0; start < unique.length; start += MAX_IN_VALUES) {
    predicates.push({ _tag: "in", column, values: unique.slice(start, start + MAX_IN_VALUES) });
  }
  return predicates;
};

const readWhereIn = async <Row extends { readonly id: string }>(
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  decode: DecodeRows<Row>,
  column: string,
  values: Iterable<string> | undefined,
): Promise<ReadonlyArray<Row>> =>
  (
    await Promise.all(
      inChunks(column, values).map((where) => readAll(reader, source, decode, where)),
    )
  ).flat();

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

export const readCatalogRows = async (
  reader: ReplicaSubsetReader,
  request: CatalogRowsRequest,
): Promise<CatalogProjectionTables> => {
  const [allCategories, categories, products, categoryProducts, batches, productBatches] =
    await Promise.all([
      request.allCategories
        ? readAll<CategoryRow>(reader, "categories", decodeCategorySqliteRows)
        : [],
      readWhereIn<CategoryRow>(
        reader,
        "categories",
        decodeCategorySqliteRows,
        "id",
        request.categoryIds,
      ),
      readWhereIn<ProductRow>(
        reader,
        "products",
        decodeProductSqliteRows,
        "id",
        request.productIds,
      ),
      request.anyProductInCategory === undefined
        ? []
        : readPage<ProductRow>(
            reader,
            "products",
            decodeProductSqliteRows,
            {
              _tag: "compare",
              column: "categoryId",
              op: "eq",
              value: request.anyProductInCategory,
            },
            1,
          ),
      readWhereIn<BatchRow>(reader, "batches", decodeBatchSqliteRows, "id", request.batchIds),
      readWhereIn<BatchRow>(
        reader,
        "batches",
        decodeBatchSqliteRows,
        "productId",
        request.batchesOfProductIds,
      ),
    ]);
  return {
    categories: readable(allCategories, categories),
    products: readable(products, categoryProducts),
    batches: readable(batches, productBatches),
  };
};

export const readNextInvoiceNumber = async (
  reader: ReplicaSubsetReader,
  organizationId: string,
): Promise<number> => {
  const read = await reader.readSubset({
    source: "invoices",
    where: { _tag: "compare", column: "organizationId", op: "eq", value: organizationId },
    orderBy: [{ column: "invoiceNumber", direction: "desc" }],
    limit: 1,
    offset: 0,
  });
  const latest = await Effect.runPromise(decodeInvoiceSqliteRows(read.rows));
  return nextInvoiceNumber(latest.map((invoice) => invoice.invoiceNumber));
};

export type PurchasingRowsRequest = {
  readonly allSuppliers?: boolean;
  readonly supplierIds?: Iterable<string>;
  readonly orderIds?: Iterable<string>;
  readonly anyOrderOfSupplier?: string;
  readonly itemsOfOrderIds?: Iterable<string>;
  readonly productIds?: Iterable<string>;
  readonly productsOfItems?: boolean;
};

export const readPurchasingRows = async (
  reader: ReplicaSubsetReader,
  request: PurchasingRowsRequest,
): Promise<PurchasingProjectionTables> => {
  const [allSuppliers, suppliers, orders, supplierOrders, items] = await Promise.all([
    request.allSuppliers ? readAll<SupplierRow>(reader, "suppliers", decodeSupplierSqliteRows) : [],
    readWhereIn<SupplierRow>(
      reader,
      "suppliers",
      decodeSupplierSqliteRows,
      "id",
      request.supplierIds,
    ),
    readWhereIn<PurchaseOrderRow>(
      reader,
      "purchaseOrders",
      decodePurchaseOrderSqliteRows,
      "id",
      request.orderIds,
    ),
    request.anyOrderOfSupplier === undefined
      ? []
      : readPage<PurchaseOrderRow>(
          reader,
          "purchaseOrders",
          decodePurchaseOrderSqliteRows,
          {
            _tag: "compare",
            column: "supplierId",
            op: "eq",
            value: request.anyOrderOfSupplier,
          },
          1,
        ),
    readWhereIn<PurchaseOrderItemRow>(
      reader,
      "purchaseOrderItems",
      decodePurchaseOrderItemSqliteRows,
      "purchaseOrderId",
      request.itemsOfOrderIds,
    ),
  ]);
  const products = await readWhereIn<ProductRow>(
    reader,
    "products",
    decodeProductSqliteRows,
    "id",
    [
      ...(request.productIds ?? []),
      ...(request.productsOfItems ? items.map((item) => item.productId) : []),
    ],
  );
  return {
    suppliers: readable(allSuppliers, suppliers),
    purchaseOrders: readable(orders, supplierOrders),
    purchaseOrderItems: readable(items),
    products: readable(products),
  };
};

export const readNextPurchaseOrderNumber = async (
  reader: ReplicaSubsetReader,
  organizationId: string,
): Promise<number> => {
  const read = await reader.readSubset({
    source: "purchaseOrders",
    where: { _tag: "compare", column: "organizationId", op: "eq", value: organizationId },
    orderBy: [{ column: "orderNumber", direction: "desc" }],
    limit: 1,
    offset: 0,
  });
  const latest = await Effect.runPromise(decodePurchaseOrderSqliteRows(read.rows));
  return nextInvoiceNumber(latest.map((order) => order.orderNumber));
};

export type OpenOrderLines = {
  readonly orders: ReadonlyArray<PurchaseOrderRow>;
  readonly lines: ReadonlyArray<PurchaseOrderItemRow>;
};

export const readOpenOrderLines = async (
  reader: ReplicaSubsetReader,
  productIds: Iterable<string>,
): Promise<OpenOrderLines> => {
  const products = inChunks("productId", productIds);
  if (products.length === 0) return { orders: [], lines: [] };
  const orders = await readAll<PurchaseOrderRow>(
    reader,
    "purchaseOrders",
    decodePurchaseOrderSqliteRows,
    { _tag: "in", column: "status", values: OPEN_PURCHASE_ORDER_STATUSES },
  );
  const lines = await Promise.all(
    inChunks(
      "purchaseOrderId",
      orders.map((order) => order.id),
    ).flatMap((ofOrders) =>
      products.map((ofProducts) =>
        readAll<PurchaseOrderItemRow>(
          reader,
          "purchaseOrderItems",
          decodePurchaseOrderItemSqliteRows,
          { _tag: "and", predicates: [ofProducts, ofOrders] },
        ),
      ),
    ),
  );
  return { orders, lines: lines.flat() };
};

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

const readSpecs = async (
  reader: ReplicaSubsetReader,
  specs: ReadonlyArray<InventorySubsetSpec>,
): Promise<ReadonlyArray<ReplicaRow>> => {
  const readBatch = reader.readBatch;
  if (readBatch === undefined) {
    return (await Promise.all(specs.map((spec) => reader.readSubset(spec)))).flatMap(
      (read) => read.rows,
    );
  }
  const batches: Array<Promise<ReadonlyArray<ReplicaRow>>> = [];
  for (let start = 0; start < specs.length; start += MAX_BATCH_SPECS) {
    batches.push(
      readBatch
        .call(reader, specs.slice(start, start + MAX_BATCH_SPECS))
        .then((batch) => batch.reads.flat()),
    );
  }
  return (await Promise.all(batches)).flat();
};

export const readLearnedSuppliers = async (
  reader: ReplicaSubsetReader,
  productIds: Iterable<string>,
): Promise<ReadonlyMap<string, SupplierId>> => {
  const rows = await readSpecs(reader, [...new Set(productIds)].map(latestLineSpec));
  const lines = await Effect.runPromise(decodePurchaseOrderItemSqliteRows(rows));
  const orders = await readWhereIn<PurchaseOrderRow>(
    reader,
    "purchaseOrders",
    decodePurchaseOrderSqliteRows,
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
};
