import { useAtomSet, useAtomSuspense, useAtomValue } from "@effect/atom-react";
import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import type {
  Category,
  Invoice,
  Product,
  ProductSuggestions,
  StockMovement,
  SyncEntity,
} from "@store/contracts";
import {
  coalesce,
  eq,
  inArray,
  or,
  toArray,
  useLiveInfiniteQuery,
  useLiveQuery,
  useLiveSuspenseQuery,
  type InitialQueryBuilder,
  type Ref,
} from "@tanstack/react-db";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as React from "react";

import { CANDIDATE_QUERY_SEPARATOR, minuteClockAtom, stockPolicyAtom } from "./atoms";
import type { InvoiceListFilters, InvoiceListRequest } from "./invoice-list";
import { inPageOrder } from "./list-page";
import { sharedLiveQuery } from "./live-collection";
import type { ProductFacets, ProductListFilters, ProductListRequest } from "./product-list";
import { useCatalogReplica } from "./provider";
import {
  canonicalSearchQuery,
  catalogProductSearchResults,
  type CatalogProductSearchResult,
} from "./search";
import type { Inventory } from "./types";

const IDS_PER_PREDICATE = 32;

export const HISTORY_PAGE_SIZE = 50;

export const inAnyOf = (value: Parameters<typeof inArray>[0], ids: ReadonlyArray<string>) => {
  const [first = [], second, ...rest] = Arr.chunksOf(ids, IDS_PER_PREDICATE);
  return second
    ? or(
        inArray(value, first),
        inArray(value, second),
        ...rest.map((chunk) => inArray(value, chunk)),
      )
    : inArray(value, first);
};

const categoryFields = (category: Ref<CategoryRow>) => ({
  id: category.id,
  name: category.name,
  tracksPacks: category.tracksPacks,
  organizationId: category.organizationId,
  createdByUserId: category.createdByUserId,
  updatedByUserId: category.updatedByUserId,
  deviceId: category.deviceId,
  operationId: category.operationId,
  rowVersion: category.rowVersion,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

const batchFields = (batch: Ref<BatchRow>) => ({
  id: batch.id,
  productId: batch.productId,
  batchNumber: batch.batchNumber,
  expiresAt: batch.expiresAt,
  packQuantity: batch.packQuantity,
  unitQuantity: batch.unitQuantity,
  organizationId: batch.organizationId,
  createdByUserId: batch.createdByUserId,
  updatedByUserId: batch.updatedByUserId,
  deviceId: batch.deviceId,
  operationId: batch.operationId,
  rowVersion: batch.rowVersion,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});

const invoiceItemFields = (item: Ref<InvoiceItemRow>) => ({
  id: item.id,
  invoiceId: item.invoiceId,
  productId: item.productId,
  batchId: item.batchId,
  productName: item.productName,
  batchNumber: item.batchNumber,
  quantity: item.quantity,
  quantityType: item.quantityType,
  baseUnitQuantity: item.baseUnitQuantity,
  salePrice: item.salePrice,
  organizationId: item.organizationId,
  createdByUserId: item.createdByUserId,
  updatedByUserId: item.updatedByUserId,
  deviceId: item.deviceId,
  operationId: item.operationId,
  rowVersion: item.rowVersion,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const stockMovementFields = (movement: Ref<StockMovementRow>) => ({
  id: movement.id,
  productId: movement.productId,
  batchId: movement.batchId,
  invoiceId: movement.invoiceId,
  purchaseOrderId: movement.purchaseOrderId,
  type: movement.type,
  packDelta: movement.packDelta,
  unitDelta: movement.unitDelta,
  note: movement.note,
  organizationId: movement.organizationId,
  actorUserId: movement.actorUserId,
  deviceId: movement.deviceId,
  operationId: movement.operationId,
  createdAt: movement.createdAt,
});

const UNCATEGORIZED = "Uncategorized";

const productCategoryFields = (product: Ref<ProductRow>, category: Ref<CategoryRow>) => ({
  id: product.categoryId,
  name: coalesce(category.name, UNCATEGORIZED),
  tracksPacks: coalesce(category.tracksPacks, true),
  organizationId: coalesce(category.organizationId, product.organizationId),
  createdByUserId: coalesce(category.createdByUserId, product.createdByUserId),
  updatedByUserId: coalesce(category.updatedByUserId, product.updatedByUserId),
  deviceId: coalesce(category.deviceId, product.deviceId),
  operationId: coalesce(category.operationId, product.operationId),
  rowVersion: coalesce(category.rowVersion, 0),
  createdAt: coalesce(category.createdAt, product.createdAt),
  updatedAt: coalesce(category.updatedAt, product.updatedAt),
});

const catalogProductFields = (
  query: InitialQueryBuilder,
  inventory: Pick<Inventory, "batches">,
  product: Ref<ProductRow>,
  category: Ref<CategoryRow>,
) => ({
  id: product.id,
  name: product.name,
  categoryId: product.categoryId,
  aisle: product.aisle,
  composition: product.composition,
  strength: product.strength,
  unitsPerPack: product.unitsPerPack,
  purchasePrice: product.purchasePrice,
  retailPrice: product.retailPrice,
  unitPrice: product.unitPrice,
  visible: product.visible,
  organizationId: product.organizationId,
  createdByUserId: product.createdByUserId,
  updatedByUserId: product.updatedByUserId,
  deviceId: product.deviceId,
  operationId: product.operationId,
  rowVersion: product.rowVersion,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  category: productCategoryFields(product, category),
  batches: toArray(
    query
      .from({ batch: inventory.batches })
      .where(({ batch }) => eq(batch.productId, product.id))
      .select(({ batch }) => batchFields(batch)),
  ),
});

const invoiceFields = (
  query: InitialQueryBuilder,
  inventory: Pick<Inventory, "invoiceItems">,
  invoice: Ref<InvoiceRow>,
) => ({
  id: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  customerName: invoice.customerName,
  total: invoice.total,
  organizationId: invoice.organizationId,
  createdByUserId: invoice.createdByUserId,
  updatedByUserId: invoice.updatedByUserId,
  deviceId: invoice.deviceId,
  operationId: invoice.operationId,
  rowVersion: invoice.rowVersion,
  createdAt: invoice.createdAt,
  updatedAt: invoice.updatedAt,
  items: toArray(
    query
      .from({ item: inventory.invoiceItems })
      .where(({ item }) => eq(item.invoiceId, invoice.id))
      .select(({ item }) => invoiceItemFields(item)),
  ),
});

const productsWithCategory = (
  query: InitialQueryBuilder,
  inventory: Pick<Inventory, "products" | "categories">,
) =>
  query
    .from({ product: inventory.products })
    .leftJoin({ category: inventory.categories }, ({ product, category }) =>
      eq(product.categoryId, category.id),
    );

const categoriesQuery = (inventory: Inventory) => (query: InitialQueryBuilder) =>
  query
    .from({ category: inventory.categories })
    .orderBy(({ category }) => category.name, { direction: "asc", stringSort: "locale" })
    .select(({ category }) => categoryFields(category));

const productQuery = (inventory: Inventory, productId: string) => (query: InitialQueryBuilder) =>
  productsWithCategory(query, inventory)
    .where(({ product }) => eq(product.id, productId))
    .select(({ product, category }) => catalogProductFields(query, inventory, product, category))
    .findOne();

const productsByIdQuery =
  (inventory: Inventory, productIds: ReadonlyArray<string>) => (query: InitialQueryBuilder) =>
    productsWithCategory(query, inventory)
      .where(({ product }) => inAnyOf(product.id, productIds))
      .select(({ product, category }) => catalogProductFields(query, inventory, product, category));

const stockMovementsQuery =
  (inventory: Inventory, productId: string) => (query: InitialQueryBuilder) =>
    query
      .from({ movement: inventory.stockMovements })
      .where(({ movement }) => eq(movement.productId, productId))
      .orderBy(({ movement }) => movement.createdAt, "desc")
      .select(({ movement }) => stockMovementFields(movement));

const stockMovementsFirstPageQuery =
  (inventory: Inventory, productId: string, pageSize: number) => (query: InitialQueryBuilder) =>
    stockMovementsQuery(inventory, productId)(query).limit(pageSize + 1);

const invoicesQuery = (inventory: Inventory) => (query: InitialQueryBuilder) =>
  query
    .from({ invoice: inventory.invoices })
    .orderBy(({ invoice }) => invoice.createdAt, "desc")
    .select(({ invoice }) => invoiceFields(query, inventory, invoice));

const recentInvoicesQuery = (inventory: Inventory, limit: number) => (query: InitialQueryBuilder) =>
  invoicesQuery(inventory)(query).limit(limit);

const invoiceQuery = (inventory: Inventory, invoiceId: string) => (query: InitialQueryBuilder) =>
  query
    .from({ invoice: inventory.invoices })
    .where(({ invoice }) => eq(invoice.id, invoiceId))
    .select(({ invoice }) => invoiceFields(query, inventory, invoice))
    .findOne();

const invoicesByIdQuery =
  (inventory: Inventory, invoiceIds: ReadonlyArray<string>) => (query: InitialQueryBuilder) =>
    query
      .from({ invoice: inventory.invoices })
      .where(({ invoice }) => inAnyOf(invoice.id, invoiceIds))
      .select(({ invoice }) => invoiceFields(query, inventory, invoice));

const issuedInvoicesQuery =
  (inventory: Inventory, invoiceIds: ReadonlyArray<string>) => (query: InitialQueryBuilder) =>
    query
      .from({ invoice: inventory.invoices })
      .where(({ invoice }) => inAnyOf(invoice.id, invoiceIds))
      .select(({ invoice }) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber }));

export const liveCategories = sharedLiveQuery(categoriesQuery);

export const liveProduct = sharedLiveQuery(productQuery);

export const liveProductsById = sharedLiveQuery(productsByIdQuery);

export const liveStockMovementsFirstPage = sharedLiveQuery(stockMovementsFirstPageQuery);

export const liveRecentInvoices = sharedLiveQuery(recentInvoicesQuery);

export const liveInvoice = sharedLiveQuery(invoiceQuery);

export const liveInvoicesById = sharedLiveQuery(invoicesByIdQuery);

export const useCatalogCategories = () => {
  const live = useLiveQuery({ query: categoriesQuery(useCatalogReplica()) });
  const data: ReadonlyArray<Category> = live.data;
  return { ...live, data };
};

export const useCatalogProduct = (productId: string) => {
  const live = useLiveQuery({ query: productQuery(useCatalogReplica(), productId) });
  const data: Product | undefined = live.data;
  return { ...live, data };
};

export const useStockMovementHistory = (productId: string, pageSize = HISTORY_PAGE_SIZE) => {
  const live = useLiveInfiniteQuery(stockMovementsQuery(useCatalogReplica(), productId), {
    pageSize,
  });
  const data: ReadonlyArray<StockMovement> = live.data;
  return { ...live, data };
};

const NO_INVOICES: ReadonlyArray<Invoice> = [];

export const useInventoryInvoices = (limit = HISTORY_PAGE_SIZE) => {
  const live = useLiveQuery(liveRecentInvoices(useCatalogReplica(), limit));
  const data: ReadonlyArray<Invoice> = live.data ?? NO_INVOICES;
  return { ...live, data };
};

export const useInvoiceHistory = (pageSize = HISTORY_PAGE_SIZE) => {
  const live = useLiveInfiniteQuery(invoicesQuery(useCatalogReplica()), { pageSize });
  const data: ReadonlyArray<Invoice> = live.data;
  return { ...live, data };
};

export const useInventoryInvoice = (invoiceId: string) => {
  const live = useLiveQuery({ query: invoiceQuery(useCatalogReplica(), invoiceId) });
  const data: Invoice | undefined = live.data;
  return { ...live, data };
};

const NONE_ISSUED: ReadonlyArray<Pick<Invoice, "id" | "invoiceNumber">> = [];

export const useIssuedInvoices = (
  invoiceIds: ReadonlyArray<string>,
): ReadonlyArray<Pick<Invoice, "id" | "invoiceNumber">> =>
  useLiveQuery({ query: issuedInvoicesQuery(useCatalogReplica(), invoiceIds) }).data ?? NONE_ISSUED;

export const useSuspenseCatalogCategories = (): ReadonlyArray<Category> =>
  useLiveSuspenseQuery(liveCategories(useCatalogReplica())).data;

export const useSuspenseCatalogProduct = (productId: string): Product | undefined =>
  useLiveSuspenseQuery(liveProduct(useCatalogReplica(), productId)).data;

export const useSuspenseCatalogProductsById = (
  productIds: ReadonlyArray<string>,
): ReadonlyArray<Product> =>
  useLiveSuspenseQuery(liveProductsById(useCatalogReplica(), productIds)).data;

const untilPaged = <Row, Live extends { readonly isReady: boolean }>(
  firstPage: ReadonlyArray<Row>,
  live: Live & { readonly data: ReadonlyArray<Row>; readonly hasNextPage: boolean },
  pageSize: number,
) =>
  live.isReady
    ? live
    : { ...live, data: firstPage.slice(0, pageSize), hasNextPage: firstPage.length > pageSize };

export const useSuspenseStockMovementHistory = (
  productId: string,
  pageSize = HISTORY_PAGE_SIZE,
) => {
  const inventory = useCatalogReplica();
  const firstPage: ReadonlyArray<StockMovement> = useLiveSuspenseQuery(
    liveStockMovementsFirstPage(inventory, productId, pageSize),
  ).data;
  const live = useLiveInfiniteQuery(stockMovementsQuery(inventory, productId), { pageSize });
  const data: ReadonlyArray<StockMovement> = live.data;
  return untilPaged(firstPage, { ...live, data }, pageSize);
};

export const useSuspenseInventoryInvoices = (limit = HISTORY_PAGE_SIZE): ReadonlyArray<Invoice> => {
  const inventory = useCatalogReplica();
  return useLiveSuspenseQuery(liveRecentInvoices(inventory, limit)).data;
};

export const useSuspenseInvoicePage = (request: InvoiceListRequest): ReadonlyArray<Invoice> => {
  const inventory = useCatalogReplica();
  const ids = React.useDeferredValue(useAtomSuspense(inventory.atoms.invoicePage(request)).value);
  const invoices: ReadonlyArray<Invoice> = useLiveSuspenseQuery(
    liveInvoicesById(inventory, ids),
  ).data;
  return React.useMemo(() => inPageOrder(ids, invoices), [ids, invoices]);
};

export const useSuspenseInvoiceCount = (filters: InvoiceListFilters): number =>
  React.useDeferredValue(useAtomSuspense(useCatalogReplica().atoms.invoiceCount(filters)).value);

export const useSuspenseInventoryInvoice = (invoiceId: string): Invoice | undefined =>
  useLiveSuspenseQuery(liveInvoice(useCatalogReplica(), invoiceId)).data;

const batchesOfProductsQuery =
  (inventory: Pick<Inventory, "batches">, productIds: ReadonlyArray<string>) =>
  (builder: InitialQueryBuilder) =>
    builder
      .from({ batch: inventory.batches })
      .where(({ batch }) => inAnyOf(batch.productId, productIds))
      .select(({ batch }) => batchFields(batch));

export const liveBatchesOfProducts = sharedLiveQuery(batchesOfProductsQuery);

const productsWithStock = (
  rows: ReadonlyArray<ProductRow>,
  categories: ReadonlyArray<Category>,
  batches: ReadonlyArray<Product["batches"][number]>,
): ReadonlyArray<Product> => {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const batchesByProduct = Arr.groupBy(batches, (batch) => batch.productId);
  return rows.flatMap((row) => {
    const category = categoryById.get(row.categoryId);
    return category === undefined
      ? []
      : [{ ...row, category, batches: batchesByProduct[row.id] ?? [] }];
  });
};

export const useSuspenseProductSearch = (query: string, limit = 20): ReadonlyArray<Product> => {
  const inventory = useCatalogReplica();
  const rows = useAtomSuspense(inventory.atoms.productSearch(limit)(query)).value;
  const ids = rows.map((row) => row.id);
  const categories = useLiveSuspenseQuery(liveCategories(inventory)).data;
  const batches = useLiveSuspenseQuery(liveBatchesOfProducts(inventory, ids)).data;
  return React.useMemo(
    () => productsWithStock(rows, categories, batches),
    [rows, categories, batches],
  );
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

const NO_CANDIDATES: ReadonlyArray<ProductRow> = [];

export const useCatalogProductCandidates = (queries: ReadonlyArray<string>, limit = 25) => {
  const inventory = useCatalogReplica();
  const key = [...new Set(queries.map(canonicalSearchQuery).filter((query) => query !== ""))]
    .sort()
    .join(CANDIDATE_QUERY_SEPARATOR);
  const result = useAtomValue(inventory.atoms.productCandidates(limit)(key));
  return {
    data: AsyncResult.getOrElse(result, () => NO_CANDIDATES),
    isLoading: key !== "" && !AsyncResult.isSuccess(result) && !AsyncResult.isFailure(result),
    isError: AsyncResult.isFailure(result),
  };
};

export const useCatalogProductLookup = () =>
  useAtomSet(useCatalogReplica().atoms.productLookup, { mode: "promise" });

export const batchesForProducts = (
  builder: InitialQueryBuilder,
  inventory: Pick<Inventory, "batches">,
  productIds: ReadonlyArray<string>,
) => {
  if (productIds.length === 0) return undefined;
  return builder
    .from({ batch: inventory.batches })
    .where(({ batch }) => inAnyOf(batch.productId, productIds));
};

export const useLatestSuccess = <A, E>(result: AsyncResult.AsyncResult<A, E>): Option.Option<A> => {
  const current = AsyncResult.value(result);
  const [latest, setLatest] = React.useState<Option.Option<A>>(current);
  if (Option.isSome(current) && (Option.isNone(latest) || latest.value !== current.value)) {
    setLatest(current);
  }
  return Option.isSome(current) ? current : latest;
};

const NO_PRODUCTS: ReadonlyArray<ProductRow> = [];

const NO_ROW_IDS: ReadonlySet<string> = new Set();

export const usePendingRowIds = (entity: SyncEntity): ReadonlySet<string> => {
  const inventory = useCatalogReplica();
  const result = useAtomValue(inventory.atoms.pendingRowIds(entity));
  return AsyncResult.getOrElse(result, () => NO_ROW_IDS);
};

export const useCatalogProductSearch = (query: string, limit = 50) => {
  const inventory = useCatalogReplica();
  const policy = useAtomValue(stockPolicyAtom);
  const now = useAtomValue(minuteClockAtom);
  const searched = useAtomValue(inventory.atoms.productSearch(limit)(query));
  const latest = useLatestSuccess(searched);
  const matches = Option.getOrElse(latest, () => NO_PRODUCTS);
  const matchKey = matches.map((product) => product.id).join(" ");
  const batches = useLiveQuery({
    query: (builder) => batchesForProducts(builder, inventory, matchKey ? matchKey.split(" ") : []),
  });
  const data = React.useMemo<ReadonlyArray<CatalogProductSearchResult>>(
    () => catalogProductSearchResults(matches, batches.data ?? [], policy, now),
    [matches, batches.data, policy, now],
  );
  return {
    data,
    isLoading: Option.isNone(latest) || batches.isLoading,
    isError: AsyncResult.isFailure(searched) || batches.isError,
  };
};

const NO_CATEGORIES: ReadonlyArray<Category> = [];

const NO_BATCHES: ReadonlyArray<Product["batches"][number]> = [];

export const useProductSearch = (query: string, limit = 20): ReadonlyArray<Product> => {
  const inventory = useCatalogReplica();
  const searched = useAtomValue(inventory.atoms.productSearch(limit)(query));
  const rows = Option.getOrElse(useLatestSuccess(searched), () => NO_PRODUCTS);
  const idKey = rows.map((row) => row.id).join(" ");
  const categories: ReadonlyArray<Category> =
    useLiveQuery({ query: categoriesQuery(inventory) }).data ?? NO_CATEGORIES;
  const batches =
    useLiveQuery({
      query: (builder) => batchesForProducts(builder, inventory, idKey ? idKey.split(" ") : []),
    }).data ?? NO_BATCHES;
  return React.useMemo(
    () => productsWithStock(rows, categories, batches),
    [rows, categories, batches],
  );
};
