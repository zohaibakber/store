import { DbProvider } from "@tanstack/react-db";
import * as React from "react";

import type { InventoryHost } from "@/lib/inventory-host";

import { makeInventoryActions } from "./actions";
import type { CatalogLease, CatalogLifetime } from "./lifetime";
import { StaleCatalogLease } from "./lifetime";
import type { InventoryState } from "./types";

const InventoryContext = React.createContext<InventoryState | null>(null);

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
  const organizationId = lease.scope.organizationId;
  const userId = lease.scope.userId;
  const [state, setState] = React.useState<InventoryState>({ _tag: "Opening" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void catalog.open(lease, host).then(
      (inventory) => {
        if (active) {
          setState({
            _tag: "Ready",
            inventory,
            actions: makeInventoryActions(inventory, host, {
              organizationId,
              userId,
              deviceId: host.deviceId,
            }),
          });
        }
      },
      (cause: unknown) => {
        if (!active) return;
        if (cause instanceof StaleCatalogLease) return;
        const message = cause instanceof Error ? cause.message : "Catalog storage is unavailable.";
        setState({ _tag: "Error", error: message });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, catalog, host, lease, organizationId, userId]);

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
        <DbProvider client={state.inventory.dbClient}>{children}</DbProvider>
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

export function InventoryReady({ children }: { readonly children: React.ReactNode }) {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag === "Opening") return null;
  if (state._tag === "Error") return null;
  return children;
}
