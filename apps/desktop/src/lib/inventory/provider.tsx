import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { DbProvider } from "@tanstack/react-db";
import { Cause, Effect, Exit, Schedule } from "effect";
import * as React from "react";

import type { InventoryHost } from "@/lib/inventory-host";

import type { CatalogLease, CatalogLifetime } from "./lifetime";
import { StaleCatalogLease } from "./lifetime";
import { InventorySyncStatusView } from "./sync-status";
import type { Inventory, InventoryState } from "./types";

const InventoryContext = React.createContext<InventoryState | null>(null);

const openRetrySchedule = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
);

const openCatalog = (catalog: CatalogLifetime, lease: CatalogLease, host: InventoryHost) =>
  Effect.tryPromise({
    try: () => catalog.open(lease, host),
    catch: (cause) =>
      cause instanceof StaleCatalogLease
        ? cause
        : cause instanceof Error
          ? cause
          : new Error("Catalog storage is unavailable."),
  }).pipe(
    Effect.retry({
      schedule: openRetrySchedule,
      while: (cause) => !(cause instanceof StaleCatalogLease),
    }),
  );

export function InventoryProvider({
  children,
  catalog,
  host,
  lease,
}: {
  readonly children: React.ReactNode;
  readonly catalog: CatalogLifetime;
  readonly host: InventoryHost;
  readonly lease: CatalogLease;
}) {
  const [state, setState] = React.useState<InventoryState>({ _tag: "Opening" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void Effect.runPromiseExit(openCatalog(catalog, lease, host)).then((exit) => {
      if (!active) return;
      if (Exit.isSuccess(exit)) {
        setState({
          _tag: "Ready",
          inventory: exit.value,
          actions: exit.value.actions,
        });
        return;
      }
      if (Cause.hasInterrupts(exit.cause)) return;
      const failure = Cause.squash(exit.cause);
      if (failure instanceof StaleCatalogLease) return;
      const message =
        failure instanceof Error ? failure.message : "Catalog storage is unavailable.";
      setState({ _tag: "Error", error: message });
    });
    return () => {
      active = false;
    };
  }, [attempt, catalog, host, lease]);

  if (state._tag === "Error") {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm text-destructive">{state.error}</p>
        <button
          className="text-sm underline"
          onClick={() => {
            setState({ _tag: "Opening" });
            setAttempt((value) => value + 1);
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <InventoryContext.Provider value={state}>
      {state._tag === "Ready" ? (
        <RegistryContext.Provider value={state.inventory.atoms.registry}>
          <DbProvider client={state.inventory.dbClient}>{children}</DbProvider>
        </RegistryContext.Provider>
      ) : (
        children
      )}
    </InventoryContext.Provider>
  );
}

export const useInventoryActions = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new Error("Inventory is not ready.");
  return state.actions;
};

export const useCatalogReplica = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new Error("The catalog is not ready.");
  return state.inventory;
};

export const useCatalogIsReady = () => {
  const state = React.useContext(InventoryContext);
  return state?._tag === "Ready";
};

export const useWorkspaceAtoms = () => {
  const inventory = useCatalogReplica();
  return inventory.atoms;
};

export const useCommandExecution = () => {
  const atoms = useWorkspaceAtoms();
  return useAtomValue(atoms.commandExecution);
};

export const useSharedFilters = () => {
  const atoms = useWorkspaceAtoms();
  return useAtomValue(atoms.sharedFilters);
};

export const useBindSelectedProduct = (productId: string) => {
  const atoms = useWorkspaceAtoms();
  const setSelectedProductId = useAtomSet(atoms.selectedProductId);
  React.useEffect(() => {
    setSelectedProductId(productId);
    return () => {
      setSelectedProductId(undefined);
    };
  }, [productId, setSelectedProductId]);
};

export const useBindSelectedInvoice = (invoiceId: string) => {
  const atoms = useWorkspaceAtoms();
  const setSelectedInvoiceId = useAtomSet(atoms.selectedInvoiceId);
  React.useEffect(() => {
    setSelectedInvoiceId(invoiceId);
    return () => {
      setSelectedInvoiceId(undefined);
    };
  }, [invoiceId, setSelectedInvoiceId]);
};

export function InventoryReady({ children }: { readonly children: React.ReactNode }) {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag === "Opening") return null;
  if (state._tag === "Error") return null;
  return (
    <>
      <InventoryReadyStatus inventory={state.inventory} />
      {children}
    </>
  );
}

function InventoryReadyStatus({ inventory }: { readonly inventory: Inventory }) {
  const status = useAtomValue(inventory.atoms.syncStatus);
  return <InventorySyncStatusView status={status} />;
}
