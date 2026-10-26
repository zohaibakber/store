import {
  canonicalSearchLimit,
  EMPTY_SYNC_ACTIVITY,
  syncStatusFromOutbox,
  syncStatusWithHealth,
  uniqueById,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type SyncTransfer,
} from "@store/client-db";
import {
  MAX_PRODUCT_INSIGHT_IDS,
  MAX_RESTOCK_PAGE_ROWS,
  RestockPageRequest,
  StockPolicy,
  stockPolicyVersion,
  type Category,
  type InsightsContext,
  type InsightsSummaryRead,
  type Invoice,
  type InvoiceStaff,
  type Product,
  type ProductInsight,
  type ReplicaProductRow,
  type PurchaseOrder,
  type RestockCursor,
  type RestockFilters,
  type RestockPageRead,
  type StaffState,
  type StockMovement,
  type Supplier,
  type SupplierId,
} from "@store/contracts";
import { MAX_CATALOG_NAME_LENGTH } from "@store/contracts/catalog-write";
import type { InvoiceId, ProductId, PurchaseOrderId } from "@store/contracts/ids";
import {
  entityKey,
  FULL_INVALIDATION_KEY,
  INSIGHTS_KEY,
  MAX_HISTORY_ROWS,
  MAX_IN_VALUES,
  MAX_LIST_PAGE_SIZE,
  PRODUCT_FACET_COLUMNS,
  rowKey,
  type HistoryCursor,
  type IssuedInvoice,
  type PurchaseOrderTab,
  type ReadFailure,
  type ReplicaKey,
  type ReplicaSyncActivity,
} from "@store/contracts/replica";
import { DEFAULT_STOCK_POLICY } from "@store/services/insights";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Stream from "effect/Stream";

import { replicaUnavailableCopy, RestockExportStale, STORAGE_FAILED, STORAGE_FULL } from "./errors";
import {
  invoiceFiltersPayload,
  invoicePagePayload,
  type InvoiceListFilters,
  type InvoiceListRequest,
} from "./invoice-list";
import { boundedPage } from "./list-request";
import { preferencesRuntime } from "./preferences";
import {
  facetsFrom,
  productFiltersPayload,
  productPagePayload,
  type ProductFacets,
  type ProductListFilters,
  type ProductListRequest,
} from "./product-list";
import {
  productsOnOrder,
  type ProductOnOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderListFilters,
  type PurchaseOrderListRequest,
} from "./purchasing";
import { canonicalSearchQuery, type ProductSearchStock } from "./search";
import type { InventoryLinks, InventoryServices } from "./services";
import { byLocaleName, type HistoryWindow } from "./sorting";

export const stockPolicyAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "tabaaq.stock-policy.v2",
  schema: StockPolicy,
  defaultValue: () => DEFAULT_STOCK_POLICY,
}).pipe(Atom.keepAlive);

export type ReadError = ReadFailure | RpcClientError;

type Read<A> = Atom.Atom<AsyncResult.AsyncResult<A, ReadError>>;

const INSIGHTS_ROLLOVER = Duration.minutes(15);

const PRODUCT_INSIGHT_BATCH_DELAY = Duration.millis(15);

const IDLE_CACHE = Duration.seconds(30);

const keyed = (...keys: ReadonlyArray<ReplicaKey>) => ({
  reactivityKeys: [...keys, FULL_INVALIDATION_KEY],
  timeToLive: IDLE_CACHE,
});

const PRODUCTS = keyed(entityKey("product"));
const CATEGORIES = keyed(entityKey("category"));
const CATALOG = keyed(entityKey("product"), entityKey("category"), entityKey("batch"));
const MOVEMENTS = keyed(entityKey("stockMovement"));
const INVOICES = keyed(entityKey("invoice"));
const INVOICE_LINES = keyed(entityKey("invoice"), entityKey("invoiceItem"));
const SUPPLIERS = keyed(entityKey("supplier"));
const ORDERS = keyed(entityKey("purchaseOrder"));
const ORDER_LINES = keyed(entityKey("purchaseOrder"), entityKey("purchaseOrderItem"));
const INSIGHTS = keyed(INSIGHTS_KEY);

const canonicalIds = <Id extends string>(ids: ReadonlyArray<Id>): ReadonlyArray<Id> =>
  Arr.sort(Arr.dedupe(ids), Order.String);

const inChunks = <Id, A>(
  ids: ReadonlyArray<Id>,
  read: (chunk: ReadonlyArray<Id>) => Read<A>,
): Read<ReadonlyArray<A>> => {
  const parts = Arr.chunksOf(ids, MAX_IN_VALUES).map(read);
  return Atom.make((get) => AsyncResult.all(parts.map((part) => get(part))));
};

const keepingEqualValue = <A>(atom: Read<A>): Read<A> =>
  Atom.withEquality(
    atom,
    (left, right) =>
      AsyncResult.isSuccess(left) &&
      AsyncResult.isSuccess(right) &&
      left.waiting === right.waiting &&
      Equal.equals(left.value, right.value),
  );

const insightsContextOf = (policy: StockPolicy): InsightsContext => ({
  policy,
  utcOffsetMinutes: -new Date().getTimezoneOffset(),
});

class ProductInsightRequest extends Request.Class<
  { readonly productId: ProductId; readonly context: InsightsContext },
  ProductInsight | null,
  ReadError
> {}

type MovementHistoryKey = { readonly productId: ProductId; readonly pageSize: number };

const boundedHistoryPage = (pageSize: number) =>
  Math.min(MAX_HISTORY_ROWS, Math.max(1, Math.floor(pageSize)));

type HistoryPageRead<Row> = {
  readonly rows: ReadonlyArray<Row>;
  readonly hasMore: boolean;
  readonly next: HistoryCursor | null;
};

const historyPayload = (limit: number, before: HistoryCursor | undefined) =>
  before === undefined ? { limit } : { limit, before };

const chainHistory = <Row>(
  requested: Atom.Atom<number>,
  page: (before: HistoryCursor | undefined) => Read<HistoryPageRead<Row>>,
): Read<HistoryWindow<Row>> =>
  Atom.make((get) => {
    const previous = get.self<AsyncResult.AsyncResult<HistoryWindow<Row>, ReadError>>();
    const count = get(requested);
    const rows: Array<Row> = [];
    let before: HistoryCursor | undefined;
    let loaded = 0;
    let hasMore = false;
    let refreshing = false;
    for (let index = 0; index < count; index++) {
      const result = get(page(before));
      const read = AsyncResult.value(result);
      if (Option.isNone(read)) {
        if (index === 0) {
          return AsyncResult.map(result, (first) => ({
            rows: first.rows,
            hasMore: first.hasMore,
            pages: 1,
          }));
        }
        const stale = Option.filter(
          Option.flatMap(previous, AsyncResult.value),
          (window) => window.rows.length > rows.length,
        );
        const shown: HistoryWindow<Row> = Option.getOrElse(stale, () => ({
          rows,
          hasMore: true,
          pages: loaded,
        }));
        return AsyncResult.isFailure(result)
          ? AsyncResult.failure(result.cause, {
              previousSuccess: Option.some(AsyncResult.success(shown)),
            })
          : AsyncResult.waiting(AsyncResult.success(shown));
      }
      rows.push(...read.value.rows);
      loaded = index + 1;
      hasMore = read.value.hasMore;
      refreshing = refreshing || AsyncResult.isWaiting(result);
      if (read.value.next === null) break;
      before = read.value.next;
    }
    const window: HistoryWindow<Row> = { rows, hasMore, pages: loaded };
    return refreshing
      ? AsyncResult.waiting(AsyncResult.success(window))
      : AsyncResult.success(window);
  });

const boundedPageSize = (limit: number) =>
  Math.min(MAX_LIST_PAGE_SIZE, Math.max(1, Math.floor(limit)));

const lookupNames = (names: ReadonlyArray<string>) =>
  [...new Set(names.map((name) => name.trim()))].filter(
    (name) => name !== "" && name.length <= MAX_CATALOG_NAME_LENGTH,
  );

const RUNNING_ACTIVITY = { statuses: [], activity: EMPTY_SYNC_ACTIVITY };

export type HistoryAtoms<Row> = {
  readonly pages: Atom.Writable<number>;
  readonly window: Read<HistoryWindow<Row>>;
};

const EVERY_PRODUCT: ProductListFilters = {};

export type WorkspaceAtoms = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly syncStatus: Atom.Atom<InventorySyncStatus>;
  readonly syncActivity: Atom.Atom<InventorySyncActivity>;
  readonly syncTransfer: Atom.Atom<SyncTransfer | undefined>;
  readonly storageFull: Atom.Writable<boolean>;
  readonly syncSnapshot: Read<ReplicaSyncActivity>;
  readonly productSearch: (limit: number) => (query: string) => Read<ProductSearchStock>;
  readonly insights: Read<InsightsSummaryRead>;
  readonly restockPage: (request: RestockPageRequest) => Read<RestockPageRead>;
  readonly exportBuyList: Atom.AtomResultFn<
    RestockFilters,
    ReadonlyArray<ProductInsight>,
    ReadError | RestockExportStale
  >;
  readonly productPage: (request: ProductListRequest) => Read<ReadonlyArray<ReplicaProductRow>>;
  readonly productCount: (filters: ProductListFilters) => Read<number>;
  readonly productFacets: Read<ProductFacets>;
  readonly productLookup: Atom.AtomResultFn<
    ReadonlyArray<string>,
    ReadonlyArray<ReplicaProductRow>,
    ReadError
  >;
  readonly productInsight: (productId: ProductId) => Read<ProductInsight | null>;
  readonly productsOnOrder: (
    productIds: ReadonlyArray<ProductId>,
  ) => Read<ReadonlyMap<ProductId, ProductOnOrder>>;
  readonly learnedSuppliers: (
    productIds: ReadonlyArray<ProductId>,
  ) => Read<ReadonlyMap<ProductId, SupplierId>>;
  readonly purchaseOrderCount: (tab: PurchaseOrderTab) => Read<number>;
  readonly purchaseOrderPage: (
    request: PurchaseOrderListRequest,
  ) => Read<ReadonlyArray<PurchaseOrder>>;
  readonly openPurchaseOrders: (limit: number) => Read<ReadonlyArray<PurchaseOrder>>;
  readonly purchaseOrderDetail: (orderId: PurchaseOrderId) => Read<PurchaseOrderDetail>;
  readonly purchaseOrderListCount: (filters: PurchaseOrderListFilters) => Read<number>;
  readonly catalogHoldsNothing: Read<boolean>;
  readonly suppliers: Read<ReadonlyArray<Supplier>>;
  readonly categories: Read<ReadonlyArray<Category>>;
  readonly invoicePage: (request: InvoiceListRequest) => Read<ReadonlyArray<Invoice>>;
  readonly invoiceCount: (filters: InvoiceListFilters) => Read<number>;
  readonly invoice: (invoiceId: InvoiceId) => Read<Invoice | undefined>;
  readonly invoiceStaff: (invoiceId: InvoiceId) => Read<InvoiceStaff>;
  readonly staff: Atom.Atom<Option.Option<StaffState>>;
  readonly recentInvoices: (limit: number) => Read<ReadonlyArray<Invoice>>;
  readonly issuedInvoices: (
    invoiceIds: ReadonlyArray<InvoiceId>,
  ) => Read<ReadonlyArray<IssuedInvoice>>;
  readonly product: (productId: ProductId) => Read<Product | undefined>;
  readonly productsById: (productIds: ReadonlyArray<ProductId>) => Read<ReadonlyArray<Product>>;
  readonly stockMovementHistory: (
    productId: ProductId,
    pageSize: number,
  ) => HistoryAtoms<StockMovement>;
};

export const createWorkspaceAtoms = (
  services: InventoryServices,
  links: InventoryLinks,
  registry: AtomRegistry.AtomRegistry,
): WorkspaceAtoms => {
  const { Reads, Store, Insights } = services;
  const onInsights = Insights.runtime.factory.withReactivity(INSIGHTS.reactivityKeys);

  const storageFull = Atom.make(false).pipe(Atom.setIdleTTL(0));

  const syncSnapshot = Store.runtime
    .atom((get) => {
      get(links.commitTick);
      get(links.healthTag);
      return Store.use((store) => store("SyncActivity", undefined));
    })
    .pipe(Atom.setIdleTTL(0));

  const syncStatus = Atom.make((get): InventorySyncStatus => {
    const unavailable = get(links.unavailable);
    if (Option.isSome(unavailable)) {
      return {
        _tag: "unavailable",
        reason: unavailable.value,
        message: replicaUnavailableCopy(unavailable.value),
      };
    }
    if (get(storageFull)) return { _tag: "storageError", message: STORAGE_FULL };
    const snapshot = get(syncSnapshot);
    if (AsyncResult.isFailure(snapshot)) return { _tag: "storageError", message: STORAGE_FAILED };
    const read = Option.getOrElse(AsyncResult.value(snapshot), () => RUNNING_ACTIVITY);
    return syncStatusWithHealth(syncStatusFromOutbox(read.statuses), get(links.sync));
  });

  const syncActivity = Atom.make((get): InventorySyncActivity =>
    Option.match(AsyncResult.value(get(syncSnapshot)), {
      onNone: () => EMPTY_SYNC_ACTIVITY,
      onSome: (read) => read.activity,
    }),
  );

  const insights = onInsights(
    Insights.runtime.atom((get) => {
      const context = insightsContextOf(get(stockPolicyAtom));
      return Insights.use((client) => client("InsightsSummary", { context }));
    }),
  ).pipe(Atom.withRefresh(INSIGHTS_ROLLOVER), Atom.setIdleTTL(IDLE_CACHE));

  const restockPageAtom = Atom.family((request: RestockPageRequest) =>
    Atom.make((get) =>
      get(
        Insights.query(
          "RestockPage",
          { context: insightsContextOf(get(stockPolicyAtom)), request },
          INSIGHTS,
        ),
      ),
    ),
  );

  type InsightsClient = Parameters<Parameters<typeof Insights.use>[0]>[0];

  const makeResolver = (client: InsightsClient) =>
    RequestResolver.makeGrouped<ProductInsightRequest, string>({
      key: (entry) =>
        `${stockPolicyVersion(entry.request.context.policy)}|${entry.request.context.utcOffsetMinutes}`,
      resolver: (entries) =>
        client("ProductInsights", {
          context: entries[0].request.context,
          ids: [...new Set(entries.map((entry) => entry.request.productId))],
        }).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.sync(() => {
                for (const entry of entries) entry.completeUnsafe(Exit.fail(failure));
              }),
            onSuccess: (read) =>
              Effect.sync(() => {
                const found = new Map(read.insights.map((insight) => [insight.productId, insight]));
                for (const entry of entries) {
                  entry.completeUnsafe(Exit.succeed(found.get(entry.request.productId) ?? null));
                }
              }),
          }),
        ),
    }).pipe(
      RequestResolver.setDelay(PRODUCT_INSIGHT_BATCH_DELAY),
      RequestResolver.batchN(MAX_PRODUCT_INSIGHT_IDS),
    );

  const productInsightResolver = Insights.runtime.atom(
    Insights.use((client) => Effect.succeed(makeResolver(client))),
  );

  const productInsightAtom = Atom.family((productId: ProductId) =>
    onInsights(
      Insights.runtime.atom((get) => {
        const context = insightsContextOf(get(stockPolicyAtom));
        return get
          .result(productInsightResolver)
          .pipe(
            Effect.flatMap((resolver) =>
              Effect.request(new ProductInsightRequest({ productId, context }), resolver),
            ),
          );
      }),
    ).pipe(Atom.setIdleTTL(IDLE_CACHE)),
  );

  const productSearchAtom = Atom.family((limit: number) =>
    Atom.family((query: string): Read<ProductSearchStock> =>
      Reads.query("SearchProductStock", { query, limit }, CATALOG),
    ),
  );

  const openOrderLinesAtom = Atom.family((productIds: ReadonlyArray<ProductId>) =>
    Atom.mapResult(
      inChunks(productIds, (productIds) =>
        Reads.query("OpenOrderLines", { productIds }, ORDER_LINES),
      ),
      (parts) =>
        productsOnOrder({
          orders: uniqueById(parts.flatMap((part) => part.orders)),
          lines: uniqueById(parts.flatMap((part) => part.lines)),
        }),
    ),
  );

  const learnedSuppliersAtom = Atom.family((productIds: ReadonlyArray<ProductId>) =>
    Atom.mapResult(
      inChunks(productIds, (productIds) =>
        Reads.query("LearnedSupplierIds", { productIds }, ORDER_LINES),
      ),
      (parts): ReadonlyMap<ProductId, SupplierId> =>
        new Map(
          parts.flatMap((part) =>
            part.suppliers.map((learned) => [learned.productId, learned.supplierId]),
          ),
        ),
    ),
  );

  const issuedInvoicesAtom = Atom.family((invoiceIds: ReadonlyArray<InvoiceId>) =>
    keepingEqualValue(
      Atom.mapResult(
        inChunks(invoiceIds, (ids) => Reads.query("IssuedInvoices", { ids }, INVOICES)),
        (parts): ReadonlyArray<IssuedInvoice> => parts.flatMap((part) => part.invoices),
      ),
    ),
  );

  const productsByIdAtom = Atom.family((productIds: ReadonlyArray<ProductId>) =>
    keepingEqualValue(
      Atom.mapResult(
        inChunks(productIds, (ids) => Reads.query("ProductsById", { ids }, CATALOG)),
        (parts): ReadonlyArray<Product> => parts.flatMap((part) => part.products),
      ),
    ),
  );

  const productAtom = Atom.family((productId: ProductId) =>
    keepingEqualValue(
      Atom.mapResult(
        Reads.query(
          "ProductsById",
          { ids: [productId] },
          keyed(rowKey("product", productId), entityKey("category"), entityKey("batch")),
        ),
        (read): Product | undefined => read.products[0],
      ),
    ),
  );

  const invoiceAtom = Atom.family((id: InvoiceId): Read<Invoice | undefined> =>
    keepingEqualValue(
      Atom.mapResult(
        Reads.query("InvoiceById", { id }, keyed(rowKey("invoice", id), entityKey("invoiceItem"))),
        (read): Invoice | undefined => read.invoice ?? undefined,
      ),
    ),
  );

  const invoiceStaffAtom = Atom.family((id: InvoiceId): Read<InvoiceStaff> =>
    Atom.mapResult(
      Reads.query("InvoiceStaff", { id }, keyed(rowKey("invoice", id))),
      (read) => read.staff,
    ),
  );

  const purchaseOrderDetailAtom = Atom.family((id: PurchaseOrderId): Read<PurchaseOrderDetail> =>
    keepingEqualValue(
      Atom.mapResult(
        Reads.query(
          "PurchaseOrderDetail",
          { id },
          keyed(
            rowKey("purchaseOrder", id),
            entityKey("purchaseOrderItem"),
            entityKey("stockMovement"),
          ),
        ),
        (read): PurchaseOrderDetail => ({
          order: read.order ?? undefined,
          deliveries: read.deliveries,
        }),
      ),
    ),
  );

  const movementHistoryPages = Atom.family((_key: MovementHistoryKey) =>
    Atom.make(1).pipe(Atom.setIdleTTL(IDLE_CACHE)),
  );
  const movementHistoryAtom = Atom.family(
    (key: MovementHistoryKey): Read<HistoryWindow<StockMovement>> => {
      const limit = boundedHistoryPage(key.pageSize);
      return chainHistory(movementHistoryPages(key), (before) =>
        Reads.query(
          "StockMovementHistory",
          { productId: key.productId, ...historyPayload(limit, before) },
          MOVEMENTS,
        ),
      );
    },
  );

  const productCountAtom = Atom.family((filters: ProductListFilters) =>
    Atom.mapResult(
      Reads.query(
        "ProductSummary",
        { filters: productFiltersPayload(filters), distinct: [] },
        PRODUCTS,
      ),
      (read) => read.count,
    ),
  );

  const supplierCountAtom = Atom.mapResult(
    Reads.query("SupplierCount", undefined, SUPPLIERS),
    (read) => read.count,
  );

  const catalogHoldsNothingAtom = Atom.make((get) =>
    Effect.all([get.result(productCountAtom(EVERY_PRODUCT)), get.result(supplierCountAtom)]).pipe(
      Effect.map(([products, suppliers]) => products === 0 && suppliers === 0),
    ),
  );

  const purchaseOrderCountAtom = Atom.family((filters: PurchaseOrderListFilters) =>
    Atom.mapResult(
      Reads.query(
        "PurchaseOrderCount",
        {
          filters,
        },
        ORDERS,
      ),
      (read) => read.count,
    ),
  );

  const restockPage = (context: InsightsContext, request: RestockPageRequest) =>
    AtomRegistry.getResult(registry, Insights.query("RestockPage", { context, request }, INSIGHTS));

  const exportBuyList = Atom.fn<RestockFilters>()((filters) =>
    Stream.paginate<RestockCursor | null, ProductInsight, ReadError | RestockExportStale>(
      null,
      Effect.fn("WorkspaceAtoms.exportBuyListPage")(function* (cursor: RestockCursor | null) {
        const page = yield* restockPage(insightsContextOf(registry.get(stockPolicyAtom)), {
          filters: { ...filters, ordersOnly: true },
          cursor,
          limit: MAX_RESTOCK_PAGE_ROWS,
        });
        if (page.cursorExpired) return yield* new RestockExportStale();
        return [
          page.rows,
          page.nextCursor === null ? Option.none() : Option.some(page.nextCursor),
        ] as const;
      }),
    ).pipe(Stream.runCollect),
  );

  return {
    registry,
    syncStatus,
    syncActivity,
    syncTransfer: Atom.make((get) => {
      const health = get(links.sync);
      return health._tag === "running" ? health.transfer : undefined;
    }),
    storageFull,
    syncSnapshot,
    productSearch: (limit) => {
      const bounded = canonicalSearchLimit(limit);
      return (query) => productSearchAtom(bounded)(canonicalSearchQuery(query));
    },
    productPage: Atom.family((request: ProductListRequest) =>
      Atom.mapResult(
        Reads.query("ProductPage", productPagePayload(request), PRODUCTS),
        (read) => read.products,
      ),
    ),
    productCount: productCountAtom,
    productFacets: Atom.mapResult(
      Reads.query("ProductSummary", { filters: {}, distinct: PRODUCT_FACET_COLUMNS }, PRODUCTS),
      facetsFrom,
    ),
    productLookup: Reads.runtime.fn<ReadonlyArray<string>>()(
      (names) =>
        Reads.use((reads) =>
          Effect.forEach(Arr.chunksOf(lookupNames(names), MAX_IN_VALUES), (chunk) =>
            reads("ProductsByNames", { names: chunk }),
          ),
        ).pipe(
          Effect.map((parts): ReadonlyArray<ReplicaProductRow> =>
            parts.flatMap((part) => part.products),
          ),
        ),
      { concurrent: true },
    ),
    insights,
    restockPage: restockPageAtom,
    exportBuyList,
    productInsight: productInsightAtom,
    productsOnOrder: (productIds) => openOrderLinesAtom(canonicalIds(productIds)),
    learnedSuppliers: (productIds) => learnedSuppliersAtom(canonicalIds(productIds)),
    purchaseOrderCount: (tab) => purchaseOrderCountAtom({ tab }),
    purchaseOrderPage: Atom.family((request: PurchaseOrderListRequest) =>
      Atom.mapResult(
        Reads.query(
          "PurchaseOrderPage",
          {
            ...boundedPage(request),
            filters: request.filters,
          },
          ORDER_LINES,
        ),
        (read) => read.orders,
      ),
    ),
    openPurchaseOrders: Atom.family((limit: number) =>
      Atom.mapResult(
        Reads.query("OpenPurchaseOrders", { limit: boundedPageSize(limit) }, ORDER_LINES),
        (read) => read.orders,
      ),
    ),
    purchaseOrderDetail: purchaseOrderDetailAtom,
    purchaseOrderListCount: purchaseOrderCountAtom,
    catalogHoldsNothing: catalogHoldsNothingAtom,
    suppliers: keepingEqualValue(
      Atom.mapResult(Reads.query("Suppliers", undefined, SUPPLIERS), (read) =>
        byLocaleName(read.suppliers),
      ),
    ),
    categories: keepingEqualValue(
      Atom.mapResult(Reads.query("Categories", undefined, CATEGORIES), (read) =>
        byLocaleName(read.categories),
      ),
    ),
    invoicePage: Atom.family((request: InvoiceListRequest) =>
      Atom.mapResult(
        Reads.query("InvoicePage", invoicePagePayload(request), INVOICE_LINES),
        (read) => read.invoices,
      ),
    ),
    invoiceCount: Atom.family((filters: InvoiceListFilters) =>
      Atom.mapResult(
        Reads.query("InvoiceCount", { filters: invoiceFiltersPayload(filters) }, INVOICES),
        (read) => read.count,
      ),
    ),
    invoice: invoiceAtom,
    invoiceStaff: invoiceStaffAtom,
    staff: links.staff,
    recentInvoices: Atom.family((limit: number) =>
      Atom.mapResult(
        Reads.query("InvoiceHistory", { limit: boundedHistoryPage(limit) }, INVOICE_LINES),
        (read) => read.rows,
      ),
    ),
    issuedInvoices: (invoiceIds) => issuedInvoicesAtom(canonicalIds(invoiceIds)),
    product: productAtom,
    productsById: (productIds) => productsByIdAtom(canonicalIds(productIds)),
    stockMovementHistory: (productId, pageSize) => ({
      pages: movementHistoryPages({ productId, pageSize }),
      window: movementHistoryAtom({ productId, pageSize }),
    }),
  };
};
