import { useAtomValue } from "@effect/atom-react";
import { useInventoryState, type InventorySyncStatus } from "@store/inventory-react";
import * as Atom from "effect/unstable/reactivity/Atom";

import { syncNeedsAttention } from "./sync-health";

const openingStatus = Atom.make<InventorySyncStatus>({ _tag: "caughtUp" });

export function useSyncBadge(): string | undefined {
  const state = useInventoryState();
  const status = useAtomValue(
    state._tag === "Ready" ? state.inventory.atoms.syncStatus : openingStatus,
  );
  return state._tag === "Error" || syncNeedsAttention(status) ? "!" : undefined;
}
