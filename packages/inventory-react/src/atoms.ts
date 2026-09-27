import {
  EMPTY_SYNC_ACTIVITY,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ProductRow,
  type ReplicaChangeFeed,
} from "@store/client-db";
import type { Invoice, Product, SyncEntity } from "@store/contracts";
import {
  DEFAULT_STOCK_POLICY,
  StockRecommendationService,
  stockRecommendationLayer,
  type StockPolicy,
  type StockReport,
} from "@store/services/stock-recommendations";
import { Effect, Schedule } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export const stockPolicyAtom = Atom.make(DEFAULT_STOCK_POLICY);

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

type StockRecommendationArg = {
  readonly products: ReadonlyArray<Product>;
  readonly invoices: ReadonlyArray<Invoice>;
  readonly policy: StockPolicy;
  readonly refresh: number;
};

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
  readonly initialActivity?: InventorySyncActivity;
};

const NO_PENDING_ROWS: ReadonlySet<string> = new Set();

const emptySources: WorkspaceAtomSources = {
  changes: { subscribe: () => () => undefined },
  readPendingRowIds: () => Effect.succeed(NO_PENDING_ROWS),
  searchProducts: () => Effect.succeed([]),
};

const sameRowIds = (
  left: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
  right: AsyncResult.AsyncResult<ReadonlySet<string>, WorkspaceReadError>,
) =>
  AsyncResult.isSuccess(left) &&
  AsyncResult.isSuccess(right) &&
  left.value.size === right.value.size &&
  [...left.value].every((id) => right.value.has(id));

const stockRecommendationRuntime = Atom.runtime(stockRecommendationLayer);

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
  readonly stockRecommendations: Atom.AtomResultFn<StockRecommendationArg, StockReport, string>;
};

export const createWorkspaceAtoms = (
  organizationId: string,
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
  stockRecommendations: stockRecommendationRuntime
    .fn((arg: StockRecommendationArg) =>
      StockRecommendationService.use((service) =>
        service.analyze({
          products: arg.products,
          invoices: arg.invoices,
          policy: arg.policy,
          organizationId,
        }),
      ).pipe(Effect.mapError((failure) => failure.message)),
    )
    .pipe(Atom.keepAlive),
});
