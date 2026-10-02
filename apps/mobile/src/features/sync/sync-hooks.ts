import { useAtomValue } from "@effect/atom-react";
import { useInventoryState, type InventorySyncStatus } from "@store/inventory-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as React from "react";

import { useSyncNow } from "@/inventory";

import { syncNeedsAttention } from "./sync-view";

const openingStatus = Atom.make<InventorySyncStatus>({ _tag: "caughtUp" });

export function useSyncBadge(): string | undefined {
  const state = useInventoryState();
  const status = useAtomValue(
    state._tag === "Ready" ? state.inventory.atoms.syncStatus : openingStatus,
  );
  return state._tag === "Error" || syncNeedsAttention(status) ? "!" : undefined;
}

export function useSyncRefresh() {
  const syncNow = useSyncNow();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = () => {
    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  };
  return { refreshing, refresh };
}
