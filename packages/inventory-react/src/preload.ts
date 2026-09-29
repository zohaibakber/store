import {
  createLiveQueryCollection,
  type Context,
  type InitialQueryBuilder,
  type QueryBuilder,
} from "@tanstack/react-db";
import * as Effect from "effect/Effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import type { ProductListRequest } from "./product-list";
import {
  categoriesQuery,
  HISTORY_PAGE_SIZE,
  invoiceQuery,
  invoicesQuery,
  productQuery,
  stockMovementsQuery,
} from "./queries";
import type { Inventory } from "./types";

const WARM_GC_TIME_MS = 30_000;

type Preload = Effect.Effect<void, unknown>;

const warmQuery = <QueryContext extends Context>(
  query: (builder: InitialQueryBuilder) => QueryBuilder<QueryContext>,
): Preload =>
  Effect.tryPromise(() => createLiveQueryCollection({ query, gcTime: WARM_GC_TIME_MS }).preload());

const warmAtom = <A, E>(inventory: Inventory, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Effect.asVoid(AtomRegistry.getResult(inventory.atoms.registry, atom));

export const preloadAll = (preloads: ReadonlyArray<Preload>): Preload =>
  Effect.all(preloads, { concurrency: "unbounded", discard: true });

export const preloadCatalogCategories = (inventory: Inventory): Preload =>
  warmQuery(categoriesQuery(inventory));

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
  warmQuery(productQuery(inventory, productId));

export const preloadStockMovementHistory = (inventory: Inventory, productId: string): Preload =>
  warmQuery((builder) =>
    stockMovementsQuery(inventory, productId)(builder).limit(HISTORY_PAGE_SIZE + 1),
  );

export const preloadInventoryInvoices = (inventory: Inventory, limit: number): Preload =>
  warmQuery((builder) => invoicesQuery(inventory)(builder).limit(limit));

export const preloadInvoiceHistory = (inventory: Inventory): Preload =>
  preloadInventoryInvoices(inventory, HISTORY_PAGE_SIZE + 1);

export const preloadInventoryInvoice = (inventory: Inventory, invoiceId: string): Preload =>
  warmQuery(invoiceQuery(inventory, invoiceId));

export const preloadInventoryInsights = (inventory: Inventory): Preload =>
  warmAtom(inventory, inventory.atoms.insights);
