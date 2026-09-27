import {
  EMPTY_SYNC_ACTIVITY,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ProductRow,
  type ReplicaChangeFeed,
} from "@store/client-db";
import type { ReplicaInsightsFacts, ReplicaInsightsWindow, SyncEntity } from "@store/contracts";
import {
  DEFAULT_STOCK_POLICY,
  InsightsService,
  insightsLayer,
  insightsWindowFor,
  StockPolicy,
  type InsightsReport,
} from "@store/services/insights";
import { Effect, Layer, Schedule } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

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

export const minuteClockAtom = Atom.make((get) => {
  const fiber = Effect.runFork(
    Effect.sync(() => get.setSelf(Date.now())).pipe(Effect.schedule(Schedule.spaced("1 minute"))),
  );
  get.addFinalizer(() => {
    fiber.interruptUnsafe();
  });
  return Date.now();
});

export type CommandExecutionState =
  | { readonly _tag: "idle" }
  | { readonly _tag: "accepting"; readonly operationId: string }
  | { readonly _tag: "pending"; readonly operationId: string; readonly status: string }
  | { readonly _tag: "failed"; readonly operationId: string; readonly message: string };

type WorkspaceReadError = { readonly message: string };

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
const INSIGHTS_SETTLE_MILLIS = 750;
const INSIGHTS_DAY_ROLLOVER_MILLIS = 15 * 60_000;

const localUtcOffsetMinutes = (at: number) => -new Date(at).getTimezoneOffset();

const insightsFactsAtom = (sources: WorkspaceAtomSources) =>
  Atom.make((get) => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    get.addFinalizer(
      sources.changes.subscribe((notice) => {
        if (!notice.touchedEntities.some((entity) => INSIGHT_ENTITIES.has(entity))) return;
        clearTimeout(settle);
        settle = setTimeout(() => get.refreshSelf(), INSIGHTS_SETTLE_MILLIS);
      }),
    );
    const rollover = setInterval(() => get.refreshSelf(), INSIGHTS_DAY_ROLLOVER_MILLIS);
    get.addFinalizer(() => {
      clearTimeout(settle);
      clearInterval(rollover);
    });
    const now = Date.now();
    return sources.readInsights(insightsWindowFor(now, localUtcOffsetMinutes(now)));
  });

const refreshedOnCommits = <A>(
  sources: WorkspaceAtomSources,
  entity: SyncEntity,
  read: () => Effect.Effect<A, WorkspaceReadError>,
): Atom.Atom<AsyncResult.AsyncResult<A, WorkspaceReadError>> =>
  Atom.make((get) => {
    get.addFinalizer(
      sources.changes.subscribe((notice) => {
        if (notice.touchedEntities.includes(entity)) get.refreshSelf();
      }),
    );
    return read();
  });

const insightsReportAtom = (sources: WorkspaceAtomSources) => {
  const facts = insightsFactsAtom(sources);
  return insightsRuntime
    .atom((get) =>
      Effect.gen(function* () {
        const current = yield* get.result(facts);
        const policy = get(stockPolicyAtom);
        return yield* InsightsService.use((service) =>
          service.analyze({ facts: current, policy }),
        ).pipe(Effect.mapError((failure) => ({ message: failure.message })));
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
  readonly insights: Atom.Atom<AsyncResult.AsyncResult<InsightsReport, WorkspaceReadError>>;
};

export const createWorkspaceAtoms = (
  initialSync: InventorySyncStatus = { _tag: "caughtUp" },
  sources: WorkspaceAtomSources = emptySources,
): WorkspaceAtoms => ({
  registry: AtomRegistry.make({ defaultIdleTTL: 30_000 }),
  syncStatus: Atom.make(initialSync).pipe(Atom.keepAlive),
  syncActivity: Atom.make(sources.initialActivity ?? EMPTY_SYNC_ACTIVITY).pipe(Atom.keepAlive),
  pendingRowIds: Atom.family((entity: SyncEntity) =>
    refreshedOnCommits(sources, entity, () => sources.readPendingRowIds(entity)).pipe(
      Atom.withEquality(sameRowIds),
    ),
  ),
  productSearch: Atom.family((limit: number) =>
    Atom.family((query: string) =>
      refreshedOnCommits(sources, "product", () => sources.searchProducts(query, limit)),
    ),
  ),
  commandExecution: Atom.make<CommandExecutionState>({ _tag: "idle" }).pipe(Atom.keepAlive),
  insights: insightsReportAtom(sources),
});
