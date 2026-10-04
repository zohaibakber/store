import {
  canonicalSearchLimit,
  EMPTY_SYNC_ACTIVITY,
  syncStatusFromOutbox,
  syncStatusWithHealth,
  uniqueById,
  type CommandExecution,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ProductRow,
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
  type Product,
  type ProductInsight,
  type PurchaseOrder,
  type RestockCursor,
  type RestockFilters,
  type RestockPageRead,
  type StockMovement,
  type Supplier,
  type SupplierId,
  type SyncEntity,
} from "@store/contracts";
import { MAX_CATALOG_NAME_LENGTH } from "@store/contracts/catalog-write";
import {
  InvoiceId,
  ProductId,
  PurchaseOrderId,
  SupplierId as SupplierIdSchema,
} from "@store/contracts/ids";
import {
  entityKey,
  FULL_INVALIDATION_KEY,
  INSIGHTS_KEY,
  MAX_HISTORY_ROWS,
  MAX_IN_VALUES,
  MAX_LIST_PAGE_SIZE,
  MAX_SEARCH_QUERIES,
  PRODUCT_FACET_COLUMNS,
  ReplicaStorageError,
  rowKey,
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
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { replicaUnavailableCopy, STORAGE_FAILED, STORAGE_FULL } from "./errors";
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
import { byLocaleName, historyLimit, type HistoryWindow } from "./sorting";

export const stockPolicyAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "tabaaq.stock-policy.v2",
  schema: StockPolicy,
  defaultValue: () => DEFAULT_STOCK_POLICY,
}).pipe(Atom.keepAlive);

export const minuteClockAtom = Atom.make(() => Date.now()).pipe(Atom.withRefresh("1 minute"));

export type CommandExecutionState = { readonly _tag: "idle" } | CommandExecution;

export type ReadError = ReadFailure | RpcClientError;

type Read<A> = Atom.Atom<AsyncResult.AsyncResult<A, ReadError>>;

export const CANDIDATE_QUERY_SEPARATOR = "\n";

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

const idsKey = (ids: ReadonlyArray<string>) =>
  [...new Set(ids)].sort().join(CANDIDATE_QUERY_SEPARATOR);

const idsOfKey = (key: string) => (key === "" ? [] : key.split(CANDIDATE_QUERY_SEPARATOR));

const branded = <Id>(schema: Schema.Codec<Id, string>) => {
  const decode = Schema.decodeUnknownOption(schema);
  return (ids: ReadonlyArray<string>): ReadonlyArray<Id> =>
    ids.flatMap((id) => Option.toArray(decode(id)));
};

const productIdsOf = branded(ProductId);
const invoiceIdsOf = branded(InvoiceId);
const orderIdsOf = branded(PurchaseOrderId);
const supplierIdsOf = branded(SupplierIdSchema);

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

const sameRowIds = (
  left: AsyncResult.AsyncResult<ReadonlySet<string>, ReadError>,
  right: AsyncResult.AsyncResult<ReadonlySet<string>, ReadError>,
) =>
  AsyncResult.isSuccess(left) &&
  AsyncResult.isSuccess(right) &&
  left.value.size === right.value.size &&
  [...left.value].every((id) => right.value.has(id));

const insightsContextOf = (policy: StockPolicy): InsightsContext => ({
  policy,
  utcOffsetMinutes: -new Date().getTimezoneOffset(),
});

class ProductInsightRequest extends Request.Class<
  { readonly productId: string; readonly context: InsightsContext },
  ProductInsight | null,
  ReadError
> {}

const decodeRestockKey = Schema.decodeUnknownSync(Schema.fromJsonString(RestockPageRequest));
const encodeRestockKey = Schema.encodeSync(Schema.fromJsonString(RestockPageRequest));

type MovementHistoryKey = { readonly productId: string; readonly pageSize: number };

const boundedHistory = (pageSize: number, pages: number) =>
  Math.min(MAX_HISTORY_ROWS, historyLimit(pageSize, pages));

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

export type WorkspaceAtoms = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly syncStatus: Atom.Atom<InventorySyncStatus>;
  readonly syncActivity: Atom.Atom<InventorySyncActivity>;
  readonly syncing: Atom.Atom<boolean>;
  readonly syncTransfer: Atom.Atom<SyncTransfer | undefined>;
  readonly storageFull: Atom.Writable<boolean>;
  readonly syncSnapshot: Read<ReplicaSyncActivity>;
  readonly pendingRowIds: (entity: SyncEntity) => Read<ReadonlySet<string>>;
  readonly productSearch: (limit: number) => (query: string) => Read<ProductSearchStock>;
  readonly productCandidates: (
    limit: number,
  ) => (queries: string) => Read<ReadonlyArray<ProductRow>>;
  readonly commandExecution: Atom.Writable<CommandExecutionState>;
  readonly insights: Read<InsightsSummaryRead>;
  readonly restockPage: (request: RestockPageRequest) => Read<RestockPageRead>;
  readonly exportRestock: (filters: RestockFilters) => Stream.Stream<ProductInsight, ReadError>;
  readonly productPage: (request: ProductListRequest) => Read<ReadonlyArray<ProductRow>>;
  readonly productCount: (filters: ProductListFilters) => Read<number>;
  readonly productFacets: Read<ProductFacets>;
  readonly productLookup: Atom.AtomResultFn<
    ReadonlyArray<string>,
    ReadonlyArray<ProductRow>,
    ReadError
  >;
  readonly productInsight: (productId: string) => Read<ProductInsight | null>;
  readonly productsOnOrder: (
    productIds: ReadonlyArray<string>,
  ) => Read<ReadonlyMap<string, ProductOnOrder>>;
  readonly learnedSuppliers: (
    productIds: ReadonlyArray<string>,
  ) => Read<ReadonlyMap<string, SupplierId>>;
  readonly purchaseOrderCount: (tab: PurchaseOrderTab) => Read<number>;
  readonly purchaseOrderPage: (
    request: PurchaseOrderListRequest,
  ) => Read<ReadonlyArray<PurchaseOrder>>;
  readonly openPurchaseOrders: (limit: number) => Read<ReadonlyArray<PurchaseOrder>>;
  readonly purchaseOrderDetail: (orderId: string) => Read<PurchaseOrderDetail>;
  readonly purchaseOrderListCount: (filters: PurchaseOrderListFilters) => Read<number>;
  readonly supplierCount: Read<number>;
  readonly suppliers: Read<ReadonlyArray<Supplier>>;
  readonly categories: Read<ReadonlyArray<Category>>;
  readonly invoicePage: (request: InvoiceListRequest) => Read<ReadonlyArray<Invoice>>;
  readonly invoiceCount: (filters: InvoiceListFilters) => Read<number>;
  readonly invoice: (invoiceId: string) => Read<Invoice | undefined>;
  readonly recentInvoices: (limit: number) => Read<ReadonlyArray<Invoice>>;
  readonly issuedInvoices: (
    invoiceIds: ReadonlyArray<string>,
  ) => Read<ReadonlyArray<IssuedInvoice>>;
  readonly invoiceHistory: (pageSize: number) => HistoryAtoms<Invoice>;
  readonly product: (productId: string) => Read<Product | undefined>;
  readonly productsById: (productIds: ReadonlyArray<string>) => Read<ReadonlyArray<Product>>;
  readonly stockMovementHistory: (
    productId: string,
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

  const storageFull = Atom.make(false).pipe(Atom.keepAlive);

  const syncSnapshot = Store.runtime
    .atom((get) => {
      get(links.commitTick);
      get(links.healthTag);
      return Store.use((store) => store("SyncActivity", undefined));
    })
    .pipe(Atom.keepAlive);

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

  const restockPageAtom = Atom.family((key: string) =>
    Atom.make((get) =>
      get(
        Insights.query(
          "RestockPage",
          { context: insightsContextOf(get(stockPolicyAtom)), request: decodeRestockKey(key) },
          INSIGHTS,
        ),
      ),
    ),
  );

  type InsightsClient = Parameters<Parameters<typeof Insights.use>[0]>[0];

  const resolvers = new WeakMap<
    InsightsClient,
    RequestResolver.RequestResolver<ProductInsightRequest>
  >();

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

  const resolverOf = (client: InsightsClient) => {
    const existing = resolvers.get(client);
    if (existing !== undefined) return existing;
    const created = makeResolver(client);
    resolvers.set(client, created);
    return created;
  };

  const productInsightAtom = Atom.family((productId: string) =>
    onInsights(
      Insights.runtime.atom((get) => {
        const context = insightsContextOf(get(stockPolicyAtom));
        return Insights.use((client) =>
          Effect.request(new ProductInsightRequest({ productId, context }), resolverOf(client)),
        );
      }),
    ).pipe(Atom.setIdleTTL(IDLE_CACHE)),
  );

  const productSearchAtom = Atom.family((limit: number) =>
    Atom.family((query: string): Read<ProductSearchStock> =>
      Reads.query("SearchProductStock", { query, limit }, CATALOG),
    ),
  );

  const productCandidatesAtom = Atom.family((limit: number) =>
    Atom.family((queries: string): Read<ReadonlyArray<ProductRow>> => {
      const parts = Arr.chunksOf(idsOfKey(queries), MAX_SEARCH_QUERIES).map((chunk) =>
        Reads.query("SearchProducts", { queries: chunk, limit }, PRODUCTS),
      );
      return Atom.make((get) =>
        AsyncResult.map(
          AsyncResult.all(parts.map((part) => get(part))),
          (found): ReadonlyArray<ProductRow> => uniqueById(found.flatMap((part) => part.products)),
        ),
      );
    }),
  );

  const openOrderLinesAtom = Atom.family((key: string) =>
    Atom.mapResult(
      inChunks(productIdsOf(idsOfKey(key)), (productIds) =>
        Reads.query("OpenOrderLines", { productIds }, ORDER_LINES),
      ),
      (parts) =>
        productsOnOrder({
          orders: uniqueById(parts.flatMap((part) => part.orders)),
          lines: uniqueById(parts.flatMap((part) => part.lines)),
        }),
    ),
  );

  const learnedSuppliersAtom = Atom.family((key: string) =>
    Atom.mapResult(
      inChunks(productIdsOf(idsOfKey(key)), (productIds) =>
        Reads.query("LearnedSupplierIds", { productIds }, ORDER_LINES),
      ),
      (parts): ReadonlyMap<string, SupplierId> =>
        new Map(
          parts.flatMap((part) =>
            part.suppliers.map((learned) => [learned.productId, learned.supplierId]),
          ),
        ),
    ),
  );

  const issuedInvoicesAtom = Atom.family((key: string) =>
    keepingEqualValue(
      Atom.mapResult(
        inChunks(invoiceIdsOf(idsOfKey(key)), (ids) =>
          Reads.query("IssuedInvoices", { ids }, INVOICES),
        ),
        (parts): ReadonlyArray<IssuedInvoice> => parts.flatMap((part) => part.invoices),
      ),
    ),
  );

  const productsByIdAtom = Atom.family((key: string) =>
    keepingEqualValue(
      Atom.mapResult(
        inChunks(productIdsOf(idsOfKey(key)), (ids) =>
          Reads.query("ProductsById", { ids }, CATALOG),
        ),
        (parts): ReadonlyArray<Product> => parts.flatMap((part) => part.products),
      ),
    ),
  );

  const productAtom = Atom.family((productId: string) =>
    keepingEqualValue(
      Atom.mapResult(
        Reads.query(
          "ProductsById",
          { ids: productIdsOf([productId]) },
          keyed(rowKey("product", productId), entityKey("category"), entityKey("batch")),
        ),
        (read): Product | undefined => read.products[0],
      ),
    ),
  );

  const invoiceAtom = Atom.family((invoiceId: string): Read<Invoice | undefined> => {
    const [id] = invoiceIdsOf([invoiceId]);
    if (id === undefined) return Atom.make(AsyncResult.success(undefined));
    return keepingEqualValue(
      Atom.mapResult(
        Reads.query(
          "InvoiceById",
          { id },
          keyed(rowKey("invoice", invoiceId), entityKey("invoiceItem")),
        ),
        (read): Invoice | undefined => read.invoice ?? undefined,
      ),
    );
  });

  const NO_ORDER: PurchaseOrderDetail = { order: undefined, deliveries: [] };

  const purchaseOrderDetailAtom = Atom.family((orderId: string): Read<PurchaseOrderDetail> => {
    const [id] = orderIdsOf([orderId]);
    if (id === undefined) return Atom.make(AsyncResult.success(NO_ORDER));
    return keepingEqualValue(
      Atom.mapResult(
        Reads.query(
          "PurchaseOrderDetail",
          { id },
          keyed(
            rowKey("purchaseOrder", orderId),
            entityKey("purchaseOrderItem"),
            entityKey("stockMovement"),
          ),
        ),
        (read): PurchaseOrderDetail => ({
          order: read.order ?? undefined,
          deliveries: read.deliveries,
        }),
      ),
    );
  });

  const invoiceHistoryPages = Atom.family((_pageSize: number) =>
    Atom.make(1).pipe(Atom.setIdleTTL(IDLE_CACHE)),
  );
  const invoiceHistoryAtom = Atom.family((pageSize: number): Read<HistoryWindow<Invoice>> =>
    Atom.make((get) =>
      get(
        Reads.query(
          "InvoiceHistory",
          { limit: boundedHistory(pageSize, get(invoiceHistoryPages(pageSize))) },
          INVOICE_LINES,
        ),
      ),
    ),
  );

  const NO_MOVEMENTS: HistoryWindow<StockMovement> = { rows: [], hasMore: false, limit: 1 };

  const movementHistoryPages = Atom.family((_key: MovementHistoryKey) =>
    Atom.make(1).pipe(Atom.setIdleTTL(IDLE_CACHE)),
  );
  const movementHistoryAtom = Atom.family(
    (key: MovementHistoryKey): Read<HistoryWindow<StockMovement>> => {
      const [productId] = productIdsOf([key.productId]);
      if (productId === undefined) return Atom.make(AsyncResult.success(NO_MOVEMENTS));
      return Atom.make((get) =>
        get(
          Reads.query(
            "StockMovementHistory",
            { productId, limit: boundedHistory(key.pageSize, get(movementHistoryPages(key))) },
            MOVEMENTS,
          ),
        ),
      );
    },
  );

  const purchaseOrderCountAtom = Atom.family((filters: PurchaseOrderListFilters) =>
    Atom.mapResult(
      Reads.query(
        "PurchaseOrderCount",
        {
          filters:
            filters.supplierIds === undefined
              ? { tab: filters.tab }
              : { tab: filters.tab, supplierIds: supplierIdsOf(filters.supplierIds) },
        },
        ORDERS,
      ),
      (read) => read.count,
    ),
  );

  const restockPage = (context: InsightsContext, request: RestockPageRequest) =>
    AtomRegistry.getResult(registry, Insights.query("RestockPage", { context, request }, INSIGHTS));

  return {
    registry,
    syncStatus,
    syncActivity,
    syncing: Atom.make((get) => {
      const health = get(links.sync);
      return health._tag === "running" && health.syncing === true;
    }),
    syncTransfer: Atom.make((get) => {
      const health = get(links.sync);
      return health._tag === "running" ? health.transfer : undefined;
    }),
    storageFull,
    syncSnapshot,
    pendingRowIds: Atom.family((entity: SyncEntity) =>
      Atom.mapResult(
        Store.query("PendingRows", { entity }, keyed(entityKey(entity))),
        (ids): ReadonlySet<string> => new Set(ids),
      ).pipe(Atom.withEquality(sameRowIds)),
    ),
    productSearch: (limit) => {
      const bounded = canonicalSearchLimit(limit);
      return (query) => productSearchAtom(bounded)(canonicalSearchQuery(query));
    },
    productCandidates: (limit) => {
      const bounded = canonicalSearchLimit(limit);
      return (queries) => productCandidatesAtom(bounded)(queries);
    },
    productPage: Atom.family((request: ProductListRequest) =>
      Atom.mapResult(
        Reads.query("ProductPage", productPagePayload(request), PRODUCTS),
        (read) => read.products,
      ),
    ),
    productCount: Atom.family((filters: ProductListFilters) =>
      Atom.mapResult(
        Reads.query(
          "ProductSummary",
          { filters: productFiltersPayload(filters), distinct: [] },
          PRODUCTS,
        ),
        (read) => read.count,
      ),
    ),
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
          Effect.map((parts): ReadonlyArray<ProductRow> => parts.flatMap((part) => part.products)),
        ),
      { concurrent: true },
    ),
    commandExecution: Atom.make<CommandExecutionState>({ _tag: "idle" }).pipe(Atom.keepAlive),
    insights,
    restockPage: (request) => restockPageAtom(encodeRestockKey(request)),
    exportRestock: (filters) =>
      Stream.paginate<RestockCursor | null, ProductInsight, ReadError>(null, (cursor) =>
        Effect.suspend(() =>
          restockPage(insightsContextOf(registry.get(stockPolicyAtom)), {
            filters: { ...filters, ordersOnly: true },
            cursor,
            limit: MAX_RESTOCK_PAGE_ROWS,
          }),
        ).pipe(
          Effect.flatMap((page) =>
            page.cursorExpired
              ? Effect.fail(
                  new ReplicaStorageError({
                    message: "The insights were recalculated during the export. Try again.",
                  }),
                )
              : Effect.succeed([
                  page.rows,
                  page.nextCursor === null ? Option.none() : Option.some(page.nextCursor),
                ] as const),
          ),
        ),
      ),
    productInsight: productInsightAtom,
    productsOnOrder: (productIds) => openOrderLinesAtom(idsKey(productIds)),
    learnedSuppliers: (productIds) => learnedSuppliersAtom(idsKey(productIds)),
    purchaseOrderCount: (tab) => purchaseOrderCountAtom({ tab }),
    purchaseOrderPage: Atom.family((request: PurchaseOrderListRequest) =>
      Atom.mapResult(
        Reads.query(
          "PurchaseOrderPage",
          {
            ...boundedPage(request),
            filters:
              request.filters.supplierIds === undefined
                ? { tab: request.filters.tab }
                : {
                    tab: request.filters.tab,
                    supplierIds: supplierIdsOf(request.filters.supplierIds),
                  },
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
    supplierCount: Atom.mapResult(
      Reads.query("SupplierCount", undefined, SUPPLIERS),
      (read) => read.count,
    ),
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
    recentInvoices: Atom.family((limit: number) =>
      Atom.mapResult(
        Reads.query("InvoiceHistory", { limit: boundedHistory(limit, 1) }, INVOICE_LINES),
        (read) => read.rows,
      ),
    ),
    issuedInvoices: (invoiceIds) => issuedInvoicesAtom(idsKey(invoiceIds)),
    product: productAtom,
    productsById: (productIds) => productsByIdAtom(idsKey(productIds)),
    stockMovementHistory: (productId, pageSize) => ({
      pages: movementHistoryPages({ productId, pageSize }),
      window: movementHistoryAtom({ productId, pageSize }),
    }),
    invoiceHistory: (pageSize) => ({
      pages: invoiceHistoryPages(pageSize),
      window: invoiceHistoryAtom(pageSize),
    }),
  };
};
