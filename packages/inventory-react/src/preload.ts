import type { RestockPageRequest } from "@store/contracts";
import * as Effect from "effect/Effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { InvoiceListRequest } from "./invoice-list";
import { PURCHASE_ORDER_TABS } from "./list-request";
import type { ProductListRequest } from "./product-list";
import type { PurchaseOrderListRequest } from "./purchasing";
import { HISTORY_PAGE_SIZE } from "./queries";
import type { Inventory } from "./types";

const STILL_COMPUTING_GRACE = "120 millis";

type Preload = Effect.Effect<void, unknown>;

const warmAtom = <A, E>(inventory: Inventory, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Effect.asVoid(AtomRegistry.getResult(inventory.atoms.registry, atom));

export const preloadAll = (preloads: ReadonlyArray<Preload>): Preload =>
  Effect.all(preloads, { concurrency: "unbounded", discard: true });

export const preloadCatalogCategories = (inventory: Inventory): Preload =>
  warmAtom(inventory, inventory.atoms.categories);

export const preloadSuppliers = (inventory: Inventory): Preload =>
  warmAtom(inventory, inventory.atoms.suppliers);

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
  warmAtom(inventory, inventory.atoms.product(productId));

export const preloadCatalogProductsById = (
  inventory: Inventory,
  productIds: ReadonlyArray<string>,
): Preload => warmAtom(inventory, inventory.atoms.productsById(productIds));

export const preloadProductSearch = (inventory: Inventory, query: string, limit: number): Preload =>
  warmAtom(inventory, inventory.atoms.productSearch(limit)(query));

export const preloadStockMovementHistory = (inventory: Inventory, productId: string): Preload =>
  warmAtom(inventory, inventory.atoms.stockMovementHistory(productId, HISTORY_PAGE_SIZE).window);

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
  warmAtom(inventory, inventory.atoms.recentInvoices(limit));

export const preloadInvoiceList = (inventory: Inventory, request: InvoiceListRequest): Preload =>
  preloadAll([
    warmAtom(inventory, inventory.atoms.invoiceCount(request.filters)),
    warmAtom(inventory, inventory.atoms.invoicePage(request)),
  ]);

export const preloadInventoryInvoice = (inventory: Inventory, invoiceId: string): Preload =>
  warmAtom(inventory, inventory.atoms.invoice(invoiceId));

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
    warmAtom(inventory, inventory.atoms.purchaseOrderPage(request)),
  ]);

export const preloadPurchaseOrder = (inventory: Inventory, orderId: string): Preload =>
  preloadAll([
    preloadSuppliers(inventory),
    warmAtom(inventory, inventory.atoms.purchaseOrderDetail(orderId)),
  ]);
