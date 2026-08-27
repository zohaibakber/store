import { DbProvider } from "@tanstack/react-db";
import * as React from "react";

import type { HostInventoryScope } from "@/host-access";
import type { InventoryHost } from "@/lib/inventory-host";

import { makeInventoryActions } from "./actions";
import { inventoryScopeId, openInventory } from "./open";
import type { Inventory, InventoryState } from "./types";

const InventoryContext = React.createContext<InventoryState | null>(null);

type InventoryResource = {
  readonly promise: Promise<Inventory>;
};

const resources = new Map<string, InventoryResource>();

const resourceFor = (key: string, open: () => Promise<Inventory>): InventoryResource => {
  const existing = resources.get(key);
  if (existing) return existing;
  const resource = { promise: open() };
  resources.set(key, resource);
  return resource;
};

const disposeResource = (key: string) => {
  const resource = resources.get(key);
  if (!resource) return;
  resources.delete(key);
  void resource.promise.then((inventory) => inventory.dispose()).catch(() => undefined);
};

/** Drops every cached PowerSync database. Call on logout. */
export const disposeInventoryCache = async () => {
  const pending = [...resources.entries()];
  resources.clear();
  await Promise.all(
    pending.map(([, resource]) =>
      resource.promise.then((inventory) => inventory.dispose()).catch(() => undefined),
    ),
  );
};

export function InventoryProvider({
  children,
  host,
  scope,
}: {
  readonly children: React.ReactNode;
  readonly host: InventoryHost;
  readonly scope: HostInventoryScope;
}) {
  const resourceKey = inventoryScopeId(host, scope);
  const organizationId = scope.organizationId;
  const userId = scope.userId;
  const [state, setState] = React.useState<InventoryState>({ _tag: "Opening" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    for (const key of Array.from(resources.keys())) {
      if (key !== resourceKey) disposeResource(key);
    }
    const resource = resourceFor(resourceKey, () => openInventory(host, scope));
    void resource.promise.then(
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
        const message = cause instanceof Error ? cause.message : "Catalog storage is unavailable.";
        if (active) setState({ _tag: "Error", error: message });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, host, organizationId, resourceKey, scope, userId]);

  if (state._tag === "Error") {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive">{state.error}</p>
        <button
          className="text-sm underline"
          onClick={() => {
            disposeResource(resourceKey);
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
