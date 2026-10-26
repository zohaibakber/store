import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as React from "react";

import { InventoryNotReady, InventoryProviderMissing } from "./errors";
import { inventoryState, type CatalogOpening } from "./opening";
import type { InventoryState } from "./types";

const InventoryContext = React.createContext<InventoryState | null>(null);

export function InventoryProvider({
  children,
  opening,
}: {
  readonly children: React.ReactNode;
  readonly opening: CatalogOpening;
}) {
  const result = useAtomValue(opening);
  const retry = useAtomRefresh(opening);
  const state = React.useMemo(() => inventoryState(result, retry), [result, retry]);
  return <InventoryContext.Provider value={state}>{children}</InventoryContext.Provider>;
}

export const useInventoryState = (): InventoryState => {
  const state = React.useContext(InventoryContext);
  if (!state) throw new InventoryProviderMissing();
  return state;
};

export const useReadyInventory = () => {
  const state = React.useContext(InventoryContext);
  return state?._tag === "Ready" ? state : null;
};

export const useInventoryActions = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new InventoryNotReady();
  return state.inventory.actions;
};

export const useCatalogReplica = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new InventoryNotReady();
  return state.inventory;
};

export const useCatalogIsReady = () => {
  const state = React.useContext(InventoryContext);
  return state?._tag === "Ready";
};

export const useInventorySyncStatus = () => useAtomValue(useCatalogReplica().atoms.syncStatus);

export const useInventorySyncActivity = () => useAtomValue(useCatalogReplica().atoms.syncActivity);

export const useInventorySyncTransfer = () => useAtomValue(useCatalogReplica().atoms.syncTransfer);
