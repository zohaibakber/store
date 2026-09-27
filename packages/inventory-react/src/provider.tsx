import {
  RegistryContext,
  RegistryProvider,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { DbClient, DbProvider } from "@tanstack/react-db";
import * as React from "react";

import type { InventoryHost, InventoryScope } from "./host";
import { createAppCatalogLifetime, type CatalogLease, type CatalogLifetime } from "./lifetime";
import { closedCatalog, inventoryState, openingCatalog, type CatalogOpening } from "./opening";
import type { InventoryState } from "./types";

const InventoryContext = React.createContext<InventoryState | null>(null);

type InventoryProviderProps = {
  readonly children: React.ReactNode;
  readonly host: InventoryHost | null;
  readonly scope: InventoryScope | null;
  readonly catalog?: CatalogLifetime;
  readonly lease?: CatalogLease;
};

export function InventoryProvider({
  children,
  host,
  scope,
  catalog,
  lease,
}: InventoryProviderProps) {
  const [ownedCatalog] = React.useState(createAppCatalogLifetime);
  const lifetime = catalog ?? ownedCatalog;
  const owned = catalog === undefined;
  const organizationId = scope?.organizationId ?? null;
  const userId = scope?.userId ?? null;
  const opening = React.useMemo(
    () =>
      host === null || organizationId === null || userId === null
        ? closedCatalog
        : openingCatalog(lifetime, owned, host, { organizationId, userId }, lease),
    [host, lease, lifetime, organizationId, owned, userId],
  );
  return (
    <RegistryProvider>
      <InventoryGate opening={opening}>{children}</InventoryGate>
    </RegistryProvider>
  );
}

function InventoryGate({
  children,
  opening,
}: {
  readonly children: React.ReactNode;
  readonly opening: CatalogOpening;
}) {
  const result = useAtomValue(opening);
  const retry = useAtomRefresh(opening);
  const providerRegistry = React.useContext(RegistryContext);
  const [idleClient] = React.useState(() => new DbClient());
  const state = React.useMemo(() => inventoryState(result, retry), [result, retry]);
  const ready = state._tag === "Ready" ? state.inventory : null;
  return (
    <InventoryContext.Provider value={state}>
      <RegistryContext.Provider value={ready?.atoms.registry ?? providerRegistry}>
        <DbProvider client={ready?.dbClient ?? idleClient}>{children}</DbProvider>
      </RegistryContext.Provider>
    </InventoryContext.Provider>
  );
}

export const useInventoryState = (): InventoryState => {
  const state = React.useContext(InventoryContext);
  if (!state) throw new Error("InventoryProvider is missing.");
  return state;
};

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

export const useCommandExecution = () => useAtomValue(useCatalogReplica().atoms.commandExecution);

export const useInventorySyncStatus = () => useAtomValue(useCatalogReplica().atoms.syncStatus);

export const useInventorySyncActivity = () => useAtomValue(useCatalogReplica().atoms.syncActivity);
