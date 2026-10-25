import { useAtomSet, useAtomSuspense, useAtomValue } from "@effect/atom-react";
import type { ProductRow } from "@store/client-db";
import type { Category, Invoice, Product, ProductSuggestions } from "@store/contracts";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import * as React from "react";

import type { HistoryAtoms } from "./atoms";
import type { InvoiceListFilters, InvoiceListRequest, IssuedInvoice } from "./invoice-list";
import type { ProductFacets, ProductListFilters, ProductListRequest } from "./product-list";
import { useCatalogReplica } from "./provider";
import { type ProductSearchStock } from "./search";

export const HISTORY_PAGE_SIZE = 50;

const readState = <A, E>(result: AsyncResult.AsyncResult<A, E>) => ({
  isLoading: AsyncResult.isInitial(result),
  isReady: Option.isSome(AsyncResult.value(result)),
  isError: AsyncResult.isFailure(result),
});

const useRead = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>, empty: A) => {
  const result = useAtomValue(atom);
  return { ...readState(result), data: AsyncResult.getOrElse(result, () => empty) };
};

const useHistory = <Row>(history: HistoryAtoms<Row>) => {
  const result = useAtomValue(history.window);
  const requested = useAtomValue(history.pages);
  const setPages = useAtomSet(history.pages);
  const loaded = Option.getOrUndefined(AsyncResult.value(result));
  const hasNextPage = loaded?.hasMore ?? false;
  const loadedPages = loaded?.pages ?? 0;
  const data: ReadonlyArray<Row> = loaded?.rows ?? [];
  return {
    ...readState(result),
    data,
    hasNextPage,
    isFetchingNextPage: AsyncResult.isWaiting(result) && loadedPages < requested,
    fetchNextPage: () => {
      if (hasNextPage && loadedPages >= requested) setPages(requested + 1);
    },
  };
};

const NO_INVOICES: ReadonlyArray<Invoice> = [];

export const useInventoryInvoices = (limit = HISTORY_PAGE_SIZE) =>
  useRead(useCatalogReplica().atoms.recentInvoices(limit), NO_INVOICES);

const NONE_ISSUED: ReadonlyArray<IssuedInvoice> = [];

export const useIssuedInvoices = (
  invoiceIds: ReadonlyArray<string>,
): ReadonlyArray<IssuedInvoice> =>
  AsyncResult.getOrElse(
    useAtomValue(useCatalogReplica().atoms.issuedInvoices(invoiceIds)),
    () => NONE_ISSUED,
  );

export const useSuspenseCatalogCategories = (): ReadonlyArray<Category> =>
  useAtomSuspense(useCatalogReplica().atoms.categories).value;

export const useSuspenseCatalogProduct = (productId: string): Product | undefined =>
  useAtomSuspense(useCatalogReplica().atoms.product(productId)).value;

export const useSuspenseCatalogProductsById = (
  productIds: ReadonlyArray<string>,
): ReadonlyArray<Product> =>
  useAtomSuspense(useCatalogReplica().atoms.productsById(productIds)).value;

export const useSuspenseStockMovementHistory = (
  productId: string,
  pageSize = HISTORY_PAGE_SIZE,
) => {
  const history = useCatalogReplica().atoms.stockMovementHistory(productId, pageSize);
  useAtomSuspense(history.window);
  return useHistory(history);
};

export const useSuspenseInventoryInvoices = (limit = HISTORY_PAGE_SIZE): ReadonlyArray<Invoice> =>
  useAtomSuspense(useCatalogReplica().atoms.recentInvoices(limit)).value;

export const useSuspenseInvoicePage = (request: InvoiceListRequest): ReadonlyArray<Invoice> =>
  React.useDeferredValue(useAtomSuspense(useCatalogReplica().atoms.invoicePage(request)).value);

export const useSuspenseInvoiceCount = (filters: InvoiceListFilters): number =>
  React.useDeferredValue(useAtomSuspense(useCatalogReplica().atoms.invoiceCount(filters)).value);

export const useSuspenseInventoryInvoice = (invoiceId: string): Invoice | undefined =>
  useAtomSuspense(useCatalogReplica().atoms.invoice(invoiceId)).value;

const productsWithStock = ({
  products,
  categories,
  batches,
}: ProductSearchStock): ReadonlyArray<Product> => {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const batchesByProduct = Arr.groupBy(batches, (batch) => batch.productId);
  return products.flatMap((row) => {
    const category = categoryById.get(row.categoryId);
    return category === undefined
      ? []
      : [{ ...row, category, batches: batchesByProduct[row.id] ?? [] }];
  });
};

export const useSuspenseProductSearch = (query: string, limit = 20): ReadonlyArray<Product> => {
  const found = useAtomSuspense(useCatalogReplica().atoms.productSearch(limit)(query)).value;
  return React.useMemo(() => productsWithStock(found), [found]);
};

export const useSuspenseProductPage = (request: ProductListRequest): ReadonlyArray<ProductRow> =>
  useAtomSuspense(useCatalogReplica().atoms.productPage(request)).value;

export const useSuspenseProductCount = (filters: ProductListFilters): number =>
  useAtomSuspense(useCatalogReplica().atoms.productCount(filters)).value;

export const useSuspenseProductFacets = (): ProductFacets =>
  useAtomSuspense(useCatalogReplica().atoms.productFacets).value;

export const useSuspenseCatalogSuggestions = (): ProductSuggestions => {
  const facets = useSuspenseProductFacets();
  return { names: facets.name, aisles: facets.aisle, compositions: facets.composition };
};

export const useCatalogProductLookup = () =>
  useAtomSet(useCatalogReplica().atoms.productLookup, { mode: "promise" });

export const useLatestSuccess = <A, E>(result: AsyncResult.AsyncResult<A, E>): Option.Option<A> => {
  const current = AsyncResult.value(result);
  const [latest, setLatest] = React.useState<Option.Option<A>>(current);
  if (Option.isSome(current) && (Option.isNone(latest) || latest.value !== current.value)) {
    setLatest(current);
  }
  return Option.isSome(current) ? current : latest;
};

const NOTHING_FOUND: ProductSearchStock = { products: [], categories: [], batches: [] };

export const useProductSearch = (query: string, limit = 20): ReadonlyArray<Product> => {
  const searched = useAtomValue(useCatalogReplica().atoms.productSearch(limit)(query));
  const found = Option.getOrElse(useLatestSuccess(searched), () => NOTHING_FOUND);
  return React.useMemo(() => productsWithStock(found), [found]);
};
