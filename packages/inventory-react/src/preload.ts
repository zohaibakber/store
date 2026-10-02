import type { RestockPageRequest } from "@store/contracts";
import * as Effect from "effect/Effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { InvoiceListRequest } from "./invoice-list";
import { PURCHASE_ORDER_TABS } from "./list-request";
import type { ProductListRequest } from "./product-list";
import type { PurchaseOrderListRequest } from "./purchasing";
import {
  livePurchaseOrder,
  livePurchaseOrderDeliveries,
  livePurchaseOrdersById,
  liveSuppliers,
} from "./purchasing-queries";
import {
  HISTORY_PAGE_SIZE,
  liveBatchesOfProducts,
  liveCategories,
  liveInvoice,
  liveInvoicesById,
  liveProduct,
  liveProductsById,
  liveRecentInvoices,
  liveStockMovementsFirstPage,
} from "./queries";
import type { Inventory } from "./types";

const STILL_COMPUTING_GRACE = "120 millis";

type Preload = Effect.Effect<void, unknown>;

const warmQuery = (collection: { readonly preload: () => Promise<void> }): Preload =>
  Effect.tryPromise(() => collection.preload());

const readAtom = <A, E>(inventory: Inventory, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  AtomRegistry.getResult(inventory.atoms.registry, atom);

const warmAtom = <A, E>(inventory: Inventory, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Effect.asVoid(readAtom(inventory, atom));

export const preloadAll = (preloads: ReadonlyArray<Preload>): Preload =>
  Effect.all(preloads, { concurrency: "unbounded", discard: true });

export const preloadCatalogCategories = (inventory: Inventory): Preload =>
  warmQuery(liveCategories(inventory));

export const preloadSuppliers = (inventory: Inventory): Preload =>
  warmQuery(liveSuppliers(inventory));

export const preloadProductFacets = (inventory: Inventory): Preload =>
  warmAtom(inventory, inventory.atoms.productFacets);

export const preloadProductList = (inventory: Inventory, request: ProductListRequest): Preload =>
  preloadAll([
    preloadCatalogCategories(inventory),
    preloadProductFacets(inventory),
    warmAtom(inventory, inventory.atoms.productPage(request)),
    warmAtom(inventory, inventory.atoms.productCount(request.filters)),
  ]);

export const preloadCatalogProduct = (inventory: Inventory, productId: string): Preload =>
  warmQuery(liveProduct(inventory, productId));

export const preloadCatalogProductsById = (
  inventory: Inventory,
  productIds: ReadonlyArray<string>,
): Preload => warmQuery(liveProductsById(inventory, productIds));

export const preloadProductSearch = (inventory: Inventory, query: string, limit: number): Preload =>
  preloadAll([
    preloadCatalogCategories(inventory),
    readAtom(inventory, inventory.atoms.productSearch(limit)(query)).pipe(
      Effect.flatMap((rows) =>
        warmQuery(
          liveBatchesOfProducts(
            inventory,
            rows.map((row) => row.id),
          ),
        ),
      ),
    ),
  ]);

export const preloadStockMovementHistory = (inventory: Inventory, productId: string): Preload =>
  warmQuery(liveStockMovementsFirstPage(inventory, productId, HISTORY_PAGE_SIZE));

export const preloadProductStockPlan = (inventory: Inventory, productId: string): Preload =>
  preloadAll([
    preloadSuppliers(inventory),
    warmAtom(inventory, inventory.atoms.productsOnOrder([productId])),
    warmAtom(inventory, inventory.atoms.productInsight(productId)).pipe(
      Effect.timeoutOption(STILL_COMPUTING_GRACE),
      Effect.asVoid,
    ),
  ]);

export const preloadInventoryInvoices = (inventory: Inventory, limit: number): Preload =>
  warmQuery(liveRecentInvoices(inventory, limit));

export const preloadInvoiceList = (inventory: Inventory, request: InvoiceListRequest): Preload =>
  preloadAll([
    warmAtom(inventory, inventory.atoms.invoiceCount(request.filters)),
    readAtom(inventory, inventory.atoms.invoicePage(request)).pipe(
      Effect.flatMap((ids) => warmQuery(liveInvoicesById(inventory, ids))),
    ),
  ]);

export const preloadInventoryInvoice = (inventory: Inventory, invoiceId: string): Preload =>
  warmQuery(liveInvoice(inventory, invoiceId));

export const preloadInventoryInsights = (inventory: Inventory): Preload =>
  warmAtom(inventory, inventory.atoms.insights);

export const preloadRestockPage = (inventory: Inventory, request: RestockPageRequest): Preload =>
  preloadAll([
    preloadInventoryInsights(inventory),
    warmAtom(inventory, inventory.atoms.restockPage(request)),
  ]);

export const preloadPurchaseOrderTabs = (inventory: Inventory): Preload =>
  preloadAll(
    PURCHASE_ORDER_TABS.map((tab) => warmAtom(inventory, inventory.atoms.purchaseOrderCount(tab))),
  );

export const preloadPurchaseOrderList = (
  inventory: Inventory,
  request: PurchaseOrderListRequest,
): Preload =>
  preloadAll([
    preloadSuppliers(inventory),
    preloadPurchaseOrderTabs(inventory),
    warmAtom(inventory, inventory.atoms.purchaseOrderListCount(request.filters)),
    readAtom(inventory, inventory.atoms.purchaseOrderPage(request)).pipe(
      Effect.flatMap((ids) => warmQuery(livePurchaseOrdersById(inventory, ids))),
    ),
  ]);

export const preloadPurchaseOrder = (inventory: Inventory, orderId: string): Preload =>
  preloadAll([
    preloadSuppliers(inventory),
    warmQuery(livePurchaseOrder(inventory, orderId)),
    warmQuery(livePurchaseOrderDeliveries(inventory, orderId)),
  ]);
