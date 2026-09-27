import {
  EMPTY_SYNC_ACTIVITY,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ProductRow,
  type ReplicaChangeFeed,
  type ReplicaCommitNotice,
} from "@store/client-db";
import type { ReplicaInsightsFacts, ReplicaInsightsWindow, SyncEntity } from "@store/contracts";
import {
  DEFAULT_STOCK_POLICY,
  InsightsService,
  insightsLayer,
  insightsWindowFor,
  StockPolicy,
  type InsightsError,
  type InsightsReport,
  type ProductInsight,
} from "@store/services/insights";
import { Duration, Effect, Layer, Queue, Stream } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { WorkspaceReadFailure } from "./errors";

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
  readonly readInsights: (
    window: ReplicaInsightsWindow,
  ) => Effect.Effect<ReplicaInsightsFacts, WorkspaceReadError>;
  readonly initialActivity?: InventorySyncActivity;
};

const NO_PENDING_ROWS: ReadonlySet<string> = new Set();

const emptySources: WorkspaceAtomSources = {
  changes: { subscribe: () => () => undefined },
  readPendingRowIds: () => Effect.succeed(NO_PENDING_ROWS),
  searchProducts: () => Effect.succeed([]),
  readInsights: (window) =>
    Effect.succeed({
      window,
      products: [],
      batches: [],
      sales: [],
      days: [],
      hours: [],
      truncated: false,
    }),
};

const sameRowIds = (
  left: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
  right: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
) =>
  AsyncResult.isSuccess(left) &&
  AsyncResult.isSuccess(right) &&
  left.value.size === right.value.size &&
  [...left.value].every((id) => right.value.has(id));

const insightsRuntime = Atom.runtime(insightsLayer);

const INSIGHT_ENTITIES: ReadonlySet<SyncEntity> = new Set([
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
]);
const PRODUCT_ENTITIES: ReadonlySet<SyncEntity> = new Set(["product"]);
const INSIGHTS_SETTLE = Duration.millis(750);
const INSIGHTS_ROLLOVER = Duration.minutes(15);

const localUtcOffsetMinutes = (at: number) => -new Date(at).getTimezoneOffset();

const commitNotices = (feed: ReplicaChangeFeed) =>
  Stream.callback<ReplicaCommitNotice>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => feed.subscribe((notice) => Queue.offerUnsafe(queue, notice))),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );

const touching = (entities: ReadonlySet<SyncEntity>) => (notice: ReplicaCommitNotice) =>
  notice.touchedEntities.some((entity) => entities.has(entity));

const refreshOnCommits =
  (sources: WorkspaceAtomSources, entities: ReadonlySet<SyncEntity>, settle?: Duration.Duration) =>
  <A extends Atom.Atom<unknown>>(self: A) => {
    const relevant = commitNotices(sources.changes).pipe(Stream.filter(touching(entities)));
    return Atom.makeRefreshOnSignal(
      Atom.make(settle === undefined ? relevant : relevant.pipe(Stream.debounce(settle))),
    )(self);
  };

const insightsReportAtom = (sources: WorkspaceAtomSources) => {
  const facts = Atom.make(() => {
    const now = Date.now();
    return sources.readInsights(insightsWindowFor(now, localUtcOffsetMinutes(now)));
  }).pipe(
    Atom.withRefresh(INSIGHTS_ROLLOVER),
    refreshOnCommits(sources, INSIGHT_ENTITIES, INSIGHTS_SETTLE),
  );
  return insightsRuntime
    .atom((get) =>
      Effect.gen(function* () {
        const current = yield* get.result(facts);
        const policy = get(stockPolicyAtom);
        return yield* InsightsService.use((service) => service.analyze({ facts: current, policy }));
      }),
    )
    .pipe(Atom.keepAlive);
};

export type WorkspaceAtoms = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly syncStatus: Atom.Writable<InventorySyncStatus>;
  readonly syncActivity: Atom.Writable<InventorySyncActivity>;
  readonly pendingRowIds: (
    entity: SyncEntity,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>>;
  readonly productSearch: (
    limit: number,
  ) => (
    query: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<ProductRow>, WorkspaceReadError>>;
  readonly commandExecution: Atom.Writable<CommandExecutionState>;
  readonly insights: Atom.Atom<
    AsyncResult.AsyncResult<InsightsReport, WorkspaceReadError | InsightsError>
  >;
  readonly productInsight: (
    productId: string,
  ) => Atom.Atom<
    AsyncResult.AsyncResult<ProductInsight | null, WorkspaceReadError | InsightsError>
  >;
};

const productInsightFamily = (
  insights: WorkspaceAtoms["insights"],
): WorkspaceAtoms["productInsight"] => {
  const index = Atom.mapResult(
    insights,
    (report) => new Map(report.products.map((insight) => [insight.productId, insight])),
  );
  return Atom.family((productId: string) =>
    Atom.mapResult(index, (byId) => byId.get(productId) ?? null),
  );
};

export const createWorkspaceAtoms = (
  initialSync: InventorySyncStatus = { _tag: "caughtUp" },
  sources: WorkspaceAtomSources = emptySources,
): WorkspaceAtoms => {
  const insights = insightsReportAtom(sources);
  return {
    registry: AtomRegistry.make({ defaultIdleTTL: 30_000 }),
    syncStatus: Atom.make(initialSync).pipe(Atom.keepAlive),
    syncActivity: Atom.make(sources.initialActivity ?? EMPTY_SYNC_ACTIVITY).pipe(Atom.keepAlive),
    pendingRowIds: Atom.family((entity: SyncEntity) =>
      Atom.make(sources.readPendingRowIds(entity)).pipe(
        refreshOnCommits(sources, new Set([entity])),
        Atom.withEquality(sameRowIds),
      ),
    ),
    productSearch: Atom.family((limit: number) =>
      Atom.family((query: string) =>
        Atom.make(sources.searchProducts(query, limit)).pipe(
          refreshOnCommits(sources, PRODUCT_ENTITIES),
        ),
      ),
    ),
    commandExecution: Atom.make<CommandExecutionState>({ _tag: "idle" }).pipe(Atom.keepAlive),
    insights,
    productInsight: productInsightFamily(insights),
  };
};
