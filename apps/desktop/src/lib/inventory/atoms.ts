import type { InventorySyncStatus } from "@store/client-db";
import type { Invoice, Product } from "@store/contracts";
import {
  DEFAULT_STOCK_POLICY,
  type StockPolicy,
  type StockReport,
} from "@store/services/stock-recommendations";
import { Effect, Result } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

/** Dashboard stock-planning policy; lives on the active workspace registry. */
export const stockPolicyAtom = Atom.make(DEFAULT_STOCK_POLICY);

export type CommandExecutionState =
  | { readonly _tag: "idle" }
  | { readonly _tag: "accepting"; readonly operationId: string }
  | { readonly _tag: "pending"; readonly operationId: string; readonly status: string }
  | { readonly _tag: "failed"; readonly operationId: string; readonly message: string };

export type SharedFilterState = {
  readonly productSearch: string;
  readonly categoryId: string | undefined;
  readonly invoiceSearch: string;
};

export type StockRecommendationArg = {
  readonly products: ReadonlyArray<Product>;
  readonly invoices: ReadonlyArray<Invoice>;
  readonly policy: StockPolicy;
  readonly refresh: number;
};

export type WorkspaceAtoms = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly syncStatus: Atom.Writable<InventorySyncStatus>;
  readonly selectedProductId: Atom.Writable<string | undefined>;
  readonly selectedInvoiceId: Atom.Writable<string | undefined>;
  readonly sharedFilters: Atom.Writable<SharedFilterState>;
  readonly commandExecution: Atom.Writable<CommandExecutionState>;
  readonly stockRecommendations: Atom.AtomResultFn<StockRecommendationArg, StockReport, string>;
  readonly setSyncStatus: (status: InventorySyncStatus) => void;
  readonly getSyncStatus: () => InventorySyncStatus;
  readonly observeSyncStatus: (listener: (status: InventorySyncStatus) => void) => () => void;
  readonly setCommandExecution: (state: CommandExecutionState) => void;
  readonly dispose: () => void;
};

export const createWorkspaceAtoms = (
  initialSync: InventorySyncStatus = { _tag: "caughtUp" },
  recommendStock: (
    snapshot: {
      readonly products: ReadonlyArray<Product>;
      readonly invoices: ReadonlyArray<Invoice>;
      readonly policy: StockPolicy;
    },
    signal: AbortSignal,
  ) => Promise<Result.Result<StockReport, { readonly message: string }>>,
): WorkspaceAtoms => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  // keepAlive: workspace atoms are written from replica/actions outside React
  // subscriptions and disposed with the registry, not by idle TTL.
  const syncStatus = Atom.make(initialSync).pipe(Atom.keepAlive);
  const selectedProductId = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive);
  const selectedInvoiceId = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive);
  const sharedFilters = Atom.make<SharedFilterState>({
    productSearch: "",
    categoryId: undefined,
    invoiceSearch: "",
  }).pipe(Atom.keepAlive);
  const commandExecution = Atom.make<CommandExecutionState>({ _tag: "idle" }).pipe(Atom.keepAlive);
  const stockRecommendations = Atom.fn((arg: StockRecommendationArg) =>
    Effect.gen(function* () {
      const analyzed = yield* Effect.tryPromise({
        try: (signal) =>
          recommendStock(
            { products: arg.products, invoices: arg.invoices, policy: arg.policy },
            signal,
          ),
        catch: () => "Could not analyze saved inventory. Try refreshing the dashboard.",
      });
      if (Result.isFailure(analyzed)) {
        return yield* Effect.fail(analyzed.failure.message);
      }
      return analyzed.success;
    }),
  ).pipe(Atom.keepAlive);
  return {
    registry,
    syncStatus,
    selectedProductId,
    selectedInvoiceId,
    sharedFilters,
    commandExecution,
    stockRecommendations,
    setSyncStatus: (status) => {
      registry.set(syncStatus, status);
    },
    getSyncStatus: () => registry.get(syncStatus),
    observeSyncStatus: (listener) => registry.subscribe(syncStatus, listener, { immediate: true }),
    setCommandExecution: (state) => {
      registry.set(commandExecution, state);
    },
    dispose: () => {
      registry.dispose();
    },
  };
};
