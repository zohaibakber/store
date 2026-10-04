import type { Category } from "@store/contracts";
import { InventoryReads, IssuedInvoice, LearnedSupplier } from "@store/contracts/replica";
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
import { and, asc, eq } from "drizzle-orm";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { SqlClient } from "effect/sql/SqlClient";

import { visibleBatches } from "../replica/compile";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../replica/sources";
import type { InvoiceRow, ProductRow, PurchaseOrderRow } from "../rows";
import { matchCatalogProducts, searchTokens, uniqueById } from "./search";
import {
  among,
  containsEvery,
  invoiceOrder,
  invoiceWhere,
  issuedInvoicesOf,
  learnedSuppliersOf,
  makeReplicaReads,
  nameIs,
  nameStartsWith,
  newestFirst,
  OPEN_ORDERS,
  olderThan,
  openLinesOf,
  openOrdersOf,
  productOrder,
  PRODUCTS_BY_NAME,
  productWhere,
  purchaseOrderOrder,
  purchaseOrderWhere,
} from "./sql";

const UNCATEGORIZED = "Uncategorized";

const NAME_LOOKUP_LIMIT = 20;

const SEARCH_CANDIDATES_PER_RESULT = 4;

const uncategorized = (product: ProductRow): Category => ({
  id: product.categoryId,
  name: UNCATEGORIZED,
  tracksPacks: true,
  organizationId: product.organizationId,
  createdByUserId: product.createdByUserId,
  updatedByUserId: product.updatedByUserId,
  deviceId: product.deviceId,
  operationId: product.operationId,
  rowVersion: 0,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

const pageWindow = (page: { readonly pageIndex: number; readonly pageSize: number }) => ({
  limit: page.pageSize,
  offset: page.pageIndex * page.pageSize,
});

const historyWindow = <Row extends { readonly createdAt: number; readonly id: string }>(
  found: ReadonlyArray<Row>,
  limit: number,
) => {
  const rows = found.slice(0, limit);
  const last = rows.at(-1);
  const hasMore = found.length > limit;
  return {
    rows,
    hasMore,
    next: hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null,
  };
};

export const layerInventoryReads = InventoryReads.toLayer(
  Effect.gen(function* () {
    const { snapshot, rows, decoded, counted, facetValues } = makeReplicaReads(yield* SqlClient);
    const issuedInvoices = decoded(IssuedInvoice);
    const learnedSuppliers = decoded(LearnedSupplier);

    const batchesOf = (productIds: ReadonlyArray<string>) =>
      rows("batches", among(visibleBatches.productId, productIds), [asc(visibleBatches.id)]);

    const invoicesWithItems = Effect.fnUntraced(function* (found: ReadonlyArray<InvoiceRow>) {
      const items = yield* rows(
        "invoiceItems",
        among(
          invoiceItems.invoiceId,
          found.map((invoice) => invoice.id),
        ),
        [asc(invoiceItems.id)],
      );
      const itemsByInvoice = Arr.groupBy(items, (item) => item.invoiceId);
      return found.map((invoice) => ({ ...invoice, items: itemsByInvoice[invoice.id] ?? [] }));
    });

    const ordersWithItems = Effect.fnUntraced(function* (found: ReadonlyArray<PurchaseOrderRow>) {
      const items = yield* rows(
        "purchaseOrderItems",
        among(
          purchaseOrderItems.purchaseOrderId,
          found.map((order) => order.id),
        ),
        [asc(purchaseOrderItems.id)],
      );
      const itemsByOrder = Arr.groupBy(items, (item) => item.purchaseOrderId);
      return found.map((order) => ({ ...order, items: itemsByOrder[order.id] ?? [] }));
    });

    const searchProducts = Effect.fnUntraced(function* (query: string, limit: number) {
      const tokens = searchTokens(query);
      if (tokens.length === 0) {
        const named = yield* rows("products", undefined, PRODUCTS_BY_NAME, { limit });
        return matchCatalogProducts(named, query, limit);
      }
      const prefixed = yield* rows("products", nameStartsWith(tokens), PRODUCTS_BY_NAME, { limit });
      const containing = yield* rows("products", containsEvery(tokens), PRODUCTS_BY_NAME, {
        limit: Math.min(DEFAULT_COLLECTION_MAXIMUM_ROWS, limit * SEARCH_CANDIDATES_PER_RESULT),
      });
      return matchCatalogProducts(uniqueById([...prefixed, ...containing]), query, limit);
    });

    return InventoryReads.of({
      ProductPage: Effect.fn("InventoryReads.ProductPage")(function* (request) {
        return {
          products: yield* rows(
            "products",
            productWhere(request.filters),
            productOrder(request.sort),
            pageWindow(request),
          ),
        };
      }, snapshot),

      ProductSummary: Effect.fn("InventoryReads.ProductSummary")(function* ({ filters, distinct }) {
        const where = productWhere(filters);
        return {
          count: yield* counted("products", where),
          distinct: yield* Effect.forEach(distinct, (column) =>
            Effect.map(facetValues(column, where), (values) => ({ column, values })),
          ),
        };
      }, snapshot),

      ProductsById: Effect.fn("InventoryReads.ProductsById")(function* ({ ids }) {
        const found = yield* rows("products", among(products.id, ids), [asc(products.id)]);
        const categoryIds = Arr.dedupe(found.map((product) => product.categoryId));
        const known = yield* rows("categories", among(categories.id, categoryIds), [
          asc(categories.id),
        ]);
        const categoryById = new Map(known.map((category) => [category.id, category]));
        const batchesByProduct = Arr.groupBy(
          yield* batchesOf(found.map((product) => product.id)),
          (batch) => batch.productId,
        );
        return {
          products: found.map((product) => ({
            ...product,
            category: categoryById.get(product.categoryId) ?? uncategorized(product),
            batches: batchesByProduct[product.id] ?? [],
          })),
        };
      }, snapshot),

      ProductsByNames: Effect.fn("InventoryReads.ProductsByNames")(function* ({ names }) {
        const wanted = Arr.dedupe(names.map((name) => name.trim()).filter((name) => name !== ""));
        const found = yield* Effect.forEach(wanted, (name) =>
          rows("products", nameIs(name), [asc(products.id)], { limit: NAME_LOOKUP_LIMIT }),
        );
        return { products: uniqueById(found.flat()) };
      }, snapshot),

      Categories: Effect.fn("InventoryReads.Categories")(function* () {
        return { categories: yield* rows("categories", undefined, [asc(categories.id)]) };
      }, snapshot),

      StockMovementHistory: Effect.fn("InventoryReads.StockMovementHistory")(function* ({
        productId,
        limit,
        before,
      }) {
        return historyWindow(
          yield* rows(
            "stockMovements",
            and(eq(stockMovements.productId, productId), olderThan(stockMovements, before)),
            newestFirst(stockMovements),
            { limit: limit + 1 },
          ),
          limit,
        );
      }, snapshot),

      InvoicePage: Effect.fn("InventoryReads.InvoicePage")(function* (request) {
        const page = yield* rows(
          "invoices",
          invoiceWhere(request.filters),
          invoiceOrder(request.sort),
          pageWindow(request),
        );
        return { invoices: yield* invoicesWithItems(page) };
      }, snapshot),

      InvoiceCount: Effect.fn("InventoryReads.InvoiceCount")(function* ({ filters }) {
        return { count: yield* counted("invoices", invoiceWhere(filters)) };
      }, snapshot),

      InvoiceById: Effect.fn("InventoryReads.InvoiceById")(function* ({ id }) {
        const found = yield* rows("invoices", eq(invoices.id, id), [asc(invoices.id)]);
        return { invoice: (yield* invoicesWithItems(found)).at(0) ?? null };
      }, snapshot),

      InvoiceHistory: Effect.fn("InventoryReads.InvoiceHistory")(function* ({ limit, before }) {
        const recent = historyWindow(
          yield* rows("invoices", olderThan(invoices, before), newestFirst(invoices), {
            limit: limit + 1,
          }),
          limit,
        );
        return { ...recent, rows: yield* invoicesWithItems(recent.rows) };
      }, snapshot),

      IssuedInvoices: Effect.fn("InventoryReads.IssuedInvoices")(function* ({ ids }) {
        return { invoices: yield* issuedInvoices(issuedInvoicesOf(ids)) };
      }, snapshot),

      PurchaseOrderPage: Effect.fn("InventoryReads.PurchaseOrderPage")(function* (request) {
        const page = yield* rows(
          "purchaseOrders",
          purchaseOrderWhere(request.filters),
          purchaseOrderOrder(request.sort),
          pageWindow(request),
        );
        return { orders: yield* ordersWithItems(page) };
      }, snapshot),

      PurchaseOrderCount: Effect.fn("InventoryReads.PurchaseOrderCount")(function* ({ filters }) {
        return { count: yield* counted("purchaseOrders", purchaseOrderWhere(filters)) };
      }, snapshot),

      OpenPurchaseOrders: Effect.fn("InventoryReads.OpenPurchaseOrders")(function* ({ limit }) {
        const open = yield* rows("purchaseOrders", OPEN_ORDERS, newestFirst(purchaseOrders), {
          limit,
        });
        return { orders: yield* ordersWithItems(open) };
      }, snapshot),

      PurchaseOrderDetail: Effect.fn("InventoryReads.PurchaseOrderDetail")(function* ({ id }) {
        const found = yield* rows("purchaseOrders", eq(purchaseOrders.id, id), [
          asc(purchaseOrders.id),
        ]);
        return {
          order: (yield* ordersWithItems(found)).at(0) ?? null,
          deliveries: yield* rows(
            "stockMovements",
            eq(stockMovements.purchaseOrderId, id),
            newestFirst(stockMovements),
          ),
        };
      }, snapshot),

      OpenOrderLines: Effect.fn("InventoryReads.OpenOrderLines")(function* ({ productIds }) {
        return {
          orders: yield* rows("purchaseOrders", openOrdersOf(productIds), [asc(purchaseOrders.id)]),
          lines: yield* rows("purchaseOrderItems", openLinesOf(productIds), [
            asc(purchaseOrderItems.id),
          ]),
        };
      }, snapshot),

      LearnedSupplierIds: Effect.fn("InventoryReads.LearnedSupplierIds")(function* ({
        productIds,
      }) {
        return { suppliers: yield* learnedSuppliers(learnedSuppliersOf(productIds)) };
      }, snapshot),

      Suppliers: Effect.fn("InventoryReads.Suppliers")(function* () {
        return { suppliers: yield* rows("suppliers", undefined, [asc(suppliers.id)]) };
      }, snapshot),

      SupplierCount: Effect.fn("InventoryReads.SupplierCount")(function* () {
        return { count: yield* counted("suppliers") };
      }, snapshot),

      SearchProducts: Effect.fn("InventoryReads.SearchProducts")(function* ({ queries, limit }) {
        const matches = yield* Effect.forEach(queries, (query) => searchProducts(query, limit));
        return { products: uniqueById(matches.flat()) };
      }, snapshot),

      SearchProductStock: Effect.fn("InventoryReads.SearchProductStock")(function* ({
        query,
        limit,
      }) {
        const found = yield* searchProducts(query, limit);
        return {
          products: found,
          categories: yield* rows("categories", undefined, [asc(categories.id)]),
          batches: yield* batchesOf(found.map((product) => product.id)),
        };
      }, snapshot),
    });
  }),
);
