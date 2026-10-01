import {
  EMPTY_SYNC_ACTIVITY,
  type InventorySubsetSummary,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ProductRow,
  NOTICE_BUFFER_CAPACITY,
  noticeAffects,
  offerCoalescing,
  type ReplicaChangeFeed,
  type ReplicaCommitNotice,
} from "@store/client-db";
import {
  MAX_PRODUCT_INSIGHT_IDS,
  MAX_RESTOCK_PAGE_ROWS,
  RestockPageRequest,
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
import { DEFAULT_STOCK_POLICY, StockPolicy } from "@store/services/insights";
import {
  Clock,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Request,
  RequestResolver,
  Schema,
  Stream,
} from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { WorkspaceReadFailure } from "./errors";
import { emptyInsightsSource, type InsightsSource } from "./insights-source";
import {
  facetsFrom,
  PRODUCT_FACET_COLUMNS,
  type ProductFacetColumn,
  type ProductFacets,
  type ProductListFilters,
  type ProductListRequest,
} from "./product-list";
import type { ProductOnOrder, PurchaseOrderTab } from "./purchasing";
import { canonicalSearchLimit, canonicalSearchQuery } from "./search";

let preferenceStore: Layer.Layer<KeyValueStore.KeyValueStore> = KeyValueStore.layerMemory;

export const configureInventoryPreferences = (store: Layer.Layer<KeyValueStore.KeyValueStore>) => {
  preferenceStore = store;
};

const preferencesRuntime = Atom.runtime(() => preferenceStore);

export const stockPolicyAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "tabaaq.stock-policy.v2",
  schema: StockPolicy,
  defaultValue: () => DEFAULT_STOCK_POLICY,
}).pipe(Atom.keepAlive);

export const minuteClockAtom = Atom.make(() => Date.now()).pipe(Atom.withRefresh("1 minute"));

export type CommandExecutionState =
  | { readonly _tag: "idle" }
  | { readonly _tag: "accepting"; readonly operationId: string }
  | { readonly _tag: "pending"; readonly operationId: string; readonly status: string }
  | { readonly _tag: "failed"; readonly operationId: string; readonly message: string };

type WorkspaceReadError = WorkspaceReadFailure;

export type WorkspaceAtomSources = {
  readonly changes: ReplicaChangeFeed;
  readonly readPendingRowIds: (
    entity: SyncEntity,
  ) => Effect.Effect<ReadonlySet<string>, WorkspaceReadError>;
  readonly searchProducts: (
    query: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<ProductRow>, WorkspaceReadError>;
  readonly insights: InsightsSource;
  readonly readProductPage: (
    request: ProductListRequest,
  ) => Effect.Effect<ReadonlyArray<ProductRow>, WorkspaceReadError>;
  readonly summarizeProducts: (
    filters: ProductListFilters,
    distinct: ReadonlyArray<ProductFacetColumn>,
  ) => Effect.Effect<InventorySubsetSummary, WorkspaceReadError>;
  readonly findProductsByNames: (
    names: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ProductRow>, WorkspaceReadError>;
  readonly readProductsOnOrder: (
    productIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, ProductOnOrder>, WorkspaceReadError>;
  readonly readLearnedSuppliers: (
    productIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, SupplierId>, WorkspaceReadError>;
  readonly countPurchaseOrders: (
    tab: PurchaseOrderTab,
  ) => Effect.Effect<number, WorkspaceReadError>;
  readonly countSuppliers: Effect.Effect<number, WorkspaceReadError>;
  readonly initialActivity?: InventorySyncActivity;
};

const NO_PENDING_ROWS: ReadonlySet<string> = new Set();

const emptySources: WorkspaceAtomSources = {
  changes: { subscribe: () => () => undefined },
  readPendingRowIds: () => Effect.succeed(NO_PENDING_ROWS),
  searchProducts: () => Effect.succeed([]),
  readProductPage: () => Effect.succeed([]),
  summarizeProducts: () => Effect.succeed({ count: 0, distinct: [] }),
  findProductsByNames: () => Effect.succeed([]),
  readProductsOnOrder: () => Effect.succeed(new Map()),
  readLearnedSuppliers: () => Effect.succeed(new Map()),
  countPurchaseOrders: () => Effect.succeed(0),
  countSuppliers: Effect.succeed(0),
  insights: emptyInsightsSource,
};

const sameRowIds = (
  left: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
  right: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
) =>
  AsyncResult.isSuccess(left) &&
  AsyncResult.isSuccess(right) &&
  left.value.size === right.value.size &&
  [...left.value].every((id) => right.value.has(id));

const PRODUCT_ENTITIES: ReadonlySet<SyncEntity> = new Set(["product"]);
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

const refreshOnCommits =
  (sources: WorkspaceAtomSources, entities: ReadonlySet<SyncEntity>, settle?: Duration.Duration) =>
  <A extends Atom.Atom<unknown>>(self: A) => {
    const relevant = commitNotices(sources.changes).pipe(Stream.filter(touching(entities)));
    return Atom.makeRefreshOnSignal(
      Atom.make(settle === undefined ? relevant : relevant.pipe(Stream.debounce(settle))).pipe(
        Atom.setIdleTTL(0),
      ),
    )(self);
  };

const insightsContextOf = (policy: StockPolicy): Effect.Effect<InsightsContext> =>
  Effect.map(Clock.currentTimeMillis, (now) => ({
    policy,
    utcOffsetMinutes: localUtcOffsetMinutes(now),
  }));

const refreshOnInsightChanges =
  (source: InsightsSource) =>
  <A extends Atom.Atom<unknown>>(self: A) =>
    Atom.makeRefreshOnSignal(Atom.make(source.changes).pipe(Atom.setIdleTTL(0)))(self);

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
  readonly supplierCount: Atom.Atom<AsyncResult.AsyncResult<number, WorkspaceReadError>>;
};

export const createWorkspaceAtoms = (
  initialSync: InventorySyncStatus = { _tag: "caughtUp" },
  sources: WorkspaceAtomSources = emptySources,
): WorkspaceAtoms => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const insights = Atom.make((get) =>
    insightsContextOf(get(stockPolicyAtom)).pipe(Effect.flatMap(sources.insights.readSummary)),
  ).pipe(Atom.withRefresh(INSIGHTS_ROLLOVER), refreshOnInsightChanges(sources.insights));
  const productResolver = productInsightResolver(sources.insights);
  const restockPageAtom = Atom.family((key: string) =>
    Atom.make((get) =>
      insightsContextOf(get(stockPolicyAtom)).pipe(
        Effect.flatMap((context) =>
          sources.insights.readRestockPage(context, decodeRestockKey(key)),
        ),
      ),
    ).pipe(refreshOnInsightChanges(sources.insights)),
  );
  const productInsightAtom = Atom.family((productId: string) =>
    Atom.make((get) =>
      insightsContextOf(get(stockPolicyAtom)).pipe(
        Effect.flatMap((context) =>
          Effect.request(new ProductInsightRequest({ productId, context }), productResolver),
        ),
      ),
    ).pipe(refreshOnInsightChanges(sources.insights)),
  );
  const productSearchAtom = Atom.family((limit: number) =>
    Atom.family((query: string) =>
      Atom.make(sources.searchProducts(query, limit)).pipe(
        refreshOnCommits(sources, PRODUCT_ENTITIES),
      ),
    ),
  );
  const productCandidatesAtom = Atom.family((limit: number) =>
    Atom.family((queries: string) =>
      Atom.make(
        Effect.forEach(queries === "" ? [] : queries.split(CANDIDATE_QUERY_SEPARATOR), (query) =>
          sources.searchProducts(query, limit),
        ).pipe(
          Effect.map((groups) => [...new Map(groups.flat().map((row) => [row.id, row])).values()]),
        ),
      ).pipe(refreshOnCommits(sources, PRODUCT_ENTITIES)),
    ),
  );
  const productsOnOrderAtom = Atom.family((key: string) =>
    Atom.make(sources.readProductsOnOrder(idsOfKey(key))).pipe(
      refreshOnCommits(sources, ORDER_LINE_ENTITIES),
    ),
  );
  const learnedSuppliersAtom = Atom.family((key: string) =>
    Atom.make(sources.readLearnedSuppliers(idsOfKey(key))).pipe(
      refreshOnCommits(sources, ORDER_LINE_ENTITIES),
    ),
  );
  return {
    registry,
    syncStatus: Atom.make(initialSync).pipe(Atom.keepAlive),
    syncActivity: Atom.make(sources.initialActivity ?? EMPTY_SYNC_ACTIVITY).pipe(Atom.keepAlive),
    syncing: Atom.make(false).pipe(Atom.keepAlive),
    pendingRowIds: Atom.family((entity: SyncEntity) =>
      Atom.make(sources.readPendingRowIds(entity)).pipe(
        refreshOnCommits(sources, new Set([entity])),
        Atom.withEquality(sameRowIds),
      ),
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
      Atom.make(sources.readProductPage(request)).pipe(refreshOnCommits(sources, PRODUCT_ENTITIES)),
    ),
    productCount: Atom.family((filters: ProductListFilters) =>
      Atom.make(
        sources.summarizeProducts(filters, []).pipe(Effect.map((summary) => summary.count)),
      ).pipe(refreshOnCommits(sources, PRODUCT_ENTITIES)),
    ),
    productFacets: Atom.make(
      sources.summarizeProducts({}, PRODUCT_FACET_COLUMNS).pipe(Effect.map(facetsFrom)),
    ).pipe(refreshOnCommits(sources, PRODUCT_ENTITIES)),
    productLookup: Atom.fn((names: ReadonlyArray<string>) => sources.findProductsByNames(names), {
      concurrent: true,
    }),
    commandExecution: Atom.make<CommandExecutionState>({ _tag: "idle" }).pipe(Atom.keepAlive),
    insights,
    restockPage: (request) => restockPageAtom(encodeRestockKey(request)),
    exportRestock: (filters) =>
      Stream.paginate<RestockCursor | null, ProductInsight, WorkspaceReadError>(null, (cursor) =>
        insightsContextOf(registry.get(stockPolicyAtom)).pipe(
          Effect.flatMap((context) =>
            sources.insights.readRestockPage(context, {
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
    purchaseOrderCount: Atom.family((tab: PurchaseOrderTab) =>
      Atom.make(sources.countPurchaseOrders(tab)).pipe(
        refreshOnCommits(sources, PURCHASE_ORDER_ENTITIES),
      ),
    ),
    supplierCount: Atom.make(sources.countSuppliers).pipe(
      refreshOnCommits(sources, SUPPLIER_ENTITIES),
    ),
  };
};
