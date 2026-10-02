import {
  type CommandExecution,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ProductRow,
  NOTICE_BUFFER_CAPACITY,
  noticeAffects,
  offerCoalescing,
  type ReplicaChangeFeed,
  type ReplicaCommitNotice,
  type ReplicaHandle,
} from "@store/client-db";
import {
  MAX_PRODUCT_INSIGHT_IDS,
  MAX_RESTOCK_PAGE_ROWS,
  RestockPageRequest,
  StockPolicy,
  stockPolicyVersion,
  type InsightsContext,
  type InsightsSummaryRead,
  type ProductInsight,
  type RestockCursor,
  type RestockFilters,
  type RestockPageRead,
  type SupplierId,
  type SyncEntity,
} from "@store/contracts";
import { DEFAULT_STOCK_POLICY } from "@store/services/insights";
import {
  Clock,
  Duration,
  Effect,
  Exit,
  Option,
  Request,
  RequestResolver,
  Schema,
  Stream,
} from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { WorkspaceReadFailure, workspaceStorageFailure } from "./errors";
import type { InsightsSource } from "./insights-source";
import {
  countInvoices,
  readInvoicePageIds,
  type InvoiceListFilters,
  type InvoiceListRequest,
} from "./invoice-list";
import type { PurchaseOrderTab } from "./list-request";
import { preferencesRuntime } from "./preferences";
import {
  facetsFrom,
  findProductsByNames,
  PRODUCT_FACET_COLUMNS,
  readProductPage,
  summarizeProducts,
  type ProductFacetColumn,
  type ProductFacets,
  type ProductListFilters,
  type ProductListRequest,
} from "./product-list";
import {
  countPurchaseOrders,
  countSuppliers,
  readLearnedSupplierIds,
  readProductsOnOrder,
  readPurchaseOrderPageIds,
  type ProductOnOrder,
  type PurchaseOrderListFilters,
  type PurchaseOrderListRequest,
} from "./purchasing";
import { canonicalSearchLimit, canonicalSearchQuery, searchCatalogProducts } from "./search";

export const stockPolicyAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "tabaaq.stock-policy.v2",
  schema: StockPolicy,
  defaultValue: () => DEFAULT_STOCK_POLICY,
}).pipe(Atom.keepAlive);

export const minuteClockAtom = Atom.make(() => Date.now()).pipe(Atom.withRefresh("1 minute"));

export type CommandExecutionState = { readonly _tag: "idle" } | CommandExecution;

type WorkspaceReadError = WorkspaceReadFailure;

const readPendingRowIds = (
  replica: ReplicaHandle,
  entity: SyncEntity,
): Effect.Effect<ReadonlySet<string>, WorkspaceReadError> => {
  const readIds = replica.readPendingRowIds;
  if (readIds === undefined) return Effect.succeed(new Set<string>());
  return Effect.tryPromise({ try: () => readIds(entity), catch: workspaceStorageFailure }).pipe(
    Effect.map((ids): ReadonlySet<string> => new Set(ids)),
  );
};

const summarizeStoredProducts = (
  replica: ReplicaHandle,
  filters: ProductListFilters,
  distinct: ReadonlyArray<ProductFacetColumn>,
) => summarizeProducts(replica, filters, distinct).pipe(Effect.mapError(workspaceStorageFailure));

const sameRowIds = (
  left: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
  right: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
) =>
  AsyncResult.isSuccess(left) &&
  AsyncResult.isSuccess(right) &&
  left.value.size === right.value.size &&
  [...left.value].every((id) => right.value.has(id));

const PRODUCT_ENTITIES: ReadonlySet<SyncEntity> = new Set(["product"]);
const INVOICE_ENTITIES: ReadonlySet<SyncEntity> = new Set(["invoice"]);
const SUPPLIER_ENTITIES: ReadonlySet<SyncEntity> = new Set(["supplier"]);
const PURCHASE_ORDER_ENTITIES: ReadonlySet<SyncEntity> = new Set(["purchaseOrder"]);
const ORDER_LINE_ENTITIES: ReadonlySet<SyncEntity> = new Set([
  "purchaseOrder",
  "purchaseOrderItem",
]);
export const CANDIDATE_QUERY_SEPARATOR = "\n";

const idsKey = (ids: ReadonlyArray<string>) =>
  [...new Set(ids)].sort().join(CANDIDATE_QUERY_SEPARATOR);

const idsOfKey = (key: string) => (key === "" ? [] : key.split(CANDIDATE_QUERY_SEPARATOR));
const INSIGHTS_ROLLOVER = Duration.minutes(15);

const localUtcOffsetMinutes = (at: number) => -new Date(at).getTimezoneOffset();

const commitNotices = (feed: ReplicaChangeFeed) =>
  Stream.callback<ReplicaCommitNotice>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => feed.subscribe((notice) => offerCoalescing(queue, notice))),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: NOTICE_BUFFER_CAPACITY, strategy: "suspend" },
  );

const touching = (entities: ReadonlySet<SyncEntity>) => (notice: ReplicaCommitNotice) =>
  [...entities].some((entity) => noticeAffects(notice, entity));

const commitsTouching = (feed: ReplicaChangeFeed, entities: ReadonlySet<SyncEntity>) =>
  Atom.make(commitNotices(feed).pipe(Stream.filter(touching(entities))));

const readAfter =
  (signal: Atom.Atom<unknown>) =>
  <A, E>(read: (get: Atom.AtomContext) => Effect.Effect<A, E>) =>
    Atom.make((get) => {
      get(signal);
      return read(get);
    });

const insightsContextOf = (policy: StockPolicy): Effect.Effect<InsightsContext> =>
  Effect.map(Clock.currentTimeMillis, (now) => ({
    policy,
    utcOffsetMinutes: localUtcOffsetMinutes(now),
  }));

class ProductInsightRequest extends Request.Class<
  { readonly productId: string; readonly context: InsightsContext },
  ProductInsight | null,
  WorkspaceReadFailure
> {}

const PRODUCT_INSIGHT_BATCH_DELAY = Duration.millis(15);

const productInsightResolver = (source: InsightsSource) =>
  RequestResolver.makeGrouped<ProductInsightRequest, string>({
    key: (entry) =>
      `${stockPolicyVersion(entry.request.context.policy)}|${entry.request.context.utcOffsetMinutes}`,
    resolver: (entries) =>
      source
        .readProducts(entries[0].request.context, [
          ...new Set(entries.map((entry) => entry.request.productId)),
        ])
        .pipe(
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

const decodeRestockKey = Schema.decodeUnknownSync(Schema.fromJsonString(RestockPageRequest));
const encodeRestockKey = Schema.encodeSync(Schema.fromJsonString(RestockPageRequest));

export type WorkspaceAtoms = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly syncStatus: Atom.Writable<InventorySyncStatus>;
  readonly syncActivity: Atom.Writable<InventorySyncActivity>;
  readonly syncing: Atom.Writable<boolean>;
  readonly pendingRowIds: (
    entity: SyncEntity,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>>;
  readonly productSearch: (
    limit: number,
  ) => (
    query: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<ProductRow>, WorkspaceReadError>>;
  readonly productCandidates: (
    limit: number,
  ) => (
    queries: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<ProductRow>, WorkspaceReadError>>;
  readonly commandExecution: Atom.Writable<CommandExecutionState>;
  readonly insights: Atom.Atom<AsyncResult.AsyncResult<InsightsSummaryRead, WorkspaceReadError>>;
  readonly restockPage: (
    request: RestockPageRequest,
  ) => Atom.Atom<AsyncResult.AsyncResult<RestockPageRead, WorkspaceReadError>>;
  readonly exportRestock: (
    filters: RestockFilters,
  ) => Stream.Stream<ProductInsight, WorkspaceReadError>;
  readonly productPage: (
    request: ProductListRequest,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<ProductRow>, WorkspaceReadError>>;
  readonly productCount: (
    filters: ProductListFilters,
  ) => Atom.Atom<AsyncResult.AsyncResult<number, WorkspaceReadError>>;
  readonly productFacets: Atom.Atom<AsyncResult.AsyncResult<ProductFacets, WorkspaceReadError>>;
  readonly productLookup: Atom.AtomResultFn<
    ReadonlyArray<string>,
    ReadonlyArray<ProductRow>,
    WorkspaceReadError
  >;
  readonly productInsight: (
    productId: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<ProductInsight | null, WorkspaceReadError>>;
  readonly productsOnOrder: (
    productIds: ReadonlyArray<string>,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyMap<string, ProductOnOrder>, WorkspaceReadError>>;
  readonly learnedSuppliers: (
    productIds: ReadonlyArray<string>,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyMap<string, SupplierId>, WorkspaceReadError>>;
  readonly purchaseOrderCount: (
    tab: PurchaseOrderTab,
  ) => Atom.Atom<AsyncResult.AsyncResult<number, WorkspaceReadError>>;
  readonly purchaseOrderPage: (
    request: PurchaseOrderListRequest,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<string>, WorkspaceReadError>>;
  readonly purchaseOrderListCount: (
    filters: PurchaseOrderListFilters,
  ) => Atom.Atom<AsyncResult.AsyncResult<number, WorkspaceReadError>>;
  readonly supplierCount: Atom.Atom<AsyncResult.AsyncResult<number, WorkspaceReadError>>;
  readonly invoicePage: (
    request: InvoiceListRequest,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<string>, WorkspaceReadError>>;
  readonly invoiceCount: (
    filters: InvoiceListFilters,
  ) => Atom.Atom<AsyncResult.AsyncResult<number, WorkspaceReadError>>;
};

export const createWorkspaceAtoms = (
  replica: ReplicaHandle,
  insightsSource: InsightsSource,
  initialSync: InventorySyncStatus,
  initialActivity: InventorySyncActivity,
): WorkspaceAtoms => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const afterInsightChanges = readAfter(Atom.make(insightsSource.changes));
  const afterProductCommits = readAfter(commitsTouching(replica, PRODUCT_ENTITIES));
  const afterSupplierCommits = readAfter(commitsTouching(replica, SUPPLIER_ENTITIES));
  const afterInvoiceCommits = readAfter(commitsTouching(replica, INVOICE_ENTITIES));
  const afterOrderCommits = readAfter(commitsTouching(replica, PURCHASE_ORDER_ENTITIES));
  const afterOrderLineCommits = readAfter(commitsTouching(replica, ORDER_LINE_ENTITIES));
  const insights = afterInsightChanges((get) =>
    insightsContextOf(get(stockPolicyAtom)).pipe(Effect.flatMap(insightsSource.readSummary)),
  ).pipe(Atom.withRefresh(INSIGHTS_ROLLOVER));
  const productResolver = productInsightResolver(insightsSource);
  const restockPageAtom = Atom.family((key: string) =>
    afterInsightChanges((get) =>
      insightsContextOf(get(stockPolicyAtom)).pipe(
        Effect.flatMap((context) => insightsSource.readRestockPage(context, decodeRestockKey(key))),
      ),
    ),
  );
  const productInsightAtom = Atom.family((productId: string) =>
    afterInsightChanges((get) =>
      insightsContextOf(get(stockPolicyAtom)).pipe(
        Effect.flatMap((context) =>
          Effect.request(new ProductInsightRequest({ productId, context }), productResolver),
        ),
      ),
    ),
  );
  const productSearchAtom = Atom.family((limit: number) =>
    Atom.family((query: string) =>
      afterProductCommits(() => searchCatalogProducts(replica, query, limit)),
    ),
  );
  const productCandidatesAtom = Atom.family((limit: number) =>
    Atom.family((queries: string) =>
      afterProductCommits(() =>
        Effect.forEach(queries === "" ? [] : queries.split(CANDIDATE_QUERY_SEPARATOR), (query) =>
          searchCatalogProducts(replica, query, limit),
        ).pipe(
          Effect.map((groups) => [...new Map(groups.flat().map((row) => [row.id, row])).values()]),
        ),
      ),
    ),
  );
  const productsOnOrderAtom = Atom.family((key: string) =>
    afterOrderLineCommits(() => readProductsOnOrder(replica, idsOfKey(key))),
  );
  const learnedSuppliersAtom = Atom.family((key: string) =>
    afterOrderLineCommits(() => readLearnedSupplierIds(replica, idsOfKey(key))),
  );
  const purchaseOrderCountAtom = Atom.family((tab: PurchaseOrderTab) =>
    afterOrderCommits(() => countPurchaseOrders(replica, { tab })),
  );
  const purchaseOrderSearchCountAtom = Atom.family((filters: PurchaseOrderListFilters) =>
    afterOrderCommits(() => countPurchaseOrders(replica, filters)),
  );
  return {
    registry,
    syncStatus: Atom.make(initialSync).pipe(Atom.keepAlive),
    syncActivity: Atom.make(initialActivity).pipe(Atom.keepAlive),
    syncing: Atom.make(false).pipe(Atom.keepAlive),
    pendingRowIds: Atom.family((entity: SyncEntity) =>
      readAfter(commitsTouching(replica, new Set([entity])))(() =>
        readPendingRowIds(replica, entity),
      ).pipe(Atom.withEquality(sameRowIds)),
    ),
    productSearch: (limit: number) => {
      const bounded = canonicalSearchLimit(limit);
      return (query: string) => productSearchAtom(bounded)(canonicalSearchQuery(query));
    },
    productCandidates: (limit: number) => {
      const bounded = canonicalSearchLimit(limit);
      return (queries: string) => productCandidatesAtom(bounded)(queries);
    },
    productPage: Atom.family((request: ProductListRequest) =>
      afterProductCommits(() => readProductPage(replica, request)),
    ),
    productCount: Atom.family((filters: ProductListFilters) =>
      afterProductCommits(() =>
        summarizeStoredProducts(replica, filters, []).pipe(Effect.map((summary) => summary.count)),
      ),
    ),
    productFacets: afterProductCommits(() =>
      summarizeStoredProducts(replica, {}, PRODUCT_FACET_COLUMNS).pipe(Effect.map(facetsFrom)),
    ),
    productLookup: Atom.fn((names: ReadonlyArray<string>) => findProductsByNames(replica, names), {
      concurrent: true,
    }),
    commandExecution: Atom.make<CommandExecutionState>({ _tag: "idle" }).pipe(Atom.keepAlive),
    insights,
    restockPage: (request) => restockPageAtom(encodeRestockKey(request)),
    exportRestock: (filters) =>
      Stream.paginate<RestockCursor | null, ProductInsight, WorkspaceReadError>(null, (cursor) =>
        insightsContextOf(registry.get(stockPolicyAtom)).pipe(
          Effect.flatMap((context) =>
            insightsSource.readRestockPage(context, {
              filters: { ...filters, ordersOnly: true },
              cursor,
              limit: MAX_RESTOCK_PAGE_ROWS,
            }),
          ),
          Effect.flatMap((page) =>
            page.cursorExpired
              ? Effect.fail(
                  new WorkspaceReadFailure({
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
    productsOnOrder: (productIds) => productsOnOrderAtom(idsKey(productIds)),
    learnedSuppliers: (productIds) => learnedSuppliersAtom(idsKey(productIds)),
    purchaseOrderCount: purchaseOrderCountAtom,
    purchaseOrderPage: Atom.family((request: PurchaseOrderListRequest) =>
      afterOrderCommits(() => readPurchaseOrderPageIds(replica, request)),
    ),
    purchaseOrderListCount: (filters) =>
      filters.supplierIds === undefined
        ? purchaseOrderCountAtom(filters.tab)
        : purchaseOrderSearchCountAtom(filters),
    supplierCount: afterSupplierCommits(() => countSuppliers(replica)),
    invoicePage: Atom.family((request: InvoiceListRequest) =>
      afterInvoiceCommits(() => readInvoicePageIds(replica, request)),
    ),
    invoiceCount: Atom.family((filters: InvoiceListFilters) =>
      afterInvoiceCommits(() => countInvoices(replica, filters)),
    ),
  };
};
