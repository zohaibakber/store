import type { OfflineStoreApi } from "@store/contracts";
import { createContext, useContext, type ReactNode } from "react";

export type Store = OfflineStoreApi;

export const electronStore = (): Store => {
  const bridge = globalThis.window?.offlineStore;
  if (!bridge)
    throw new Error("The offline store bridge is unavailable. Is the preload script loaded?");
  return bridge;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ store, children }: { store: Store; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore was called outside a StoreProvider");
  return store;
}
