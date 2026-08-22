import type { SyncStatus } from "@store/contracts";
import { useEffect } from "react";

import type { Store } from "@/lib/store";

const completedSync = (status: SyncStatus): status is SyncStatus & { lastSyncedAt: number } =>
  status.lastSyncedAt !== null &&
  (status.phase === "idle" || status.phase === "live" || status.phase === "blocked");

export function SyncDataRefresh({
  store,
  refreshRoutes,
}: {
  readonly store: Store;
  readonly refreshRoutes: () => Promise<void>;
}) {
  useEffect(() => {
    let lastSyncedAt: number | undefined;
    let syncStarted = false;

    return store.onSyncStatusChange((status) => {
      if (status.phase === "syncing") {
        syncStarted = true;
        return;
      }
      if (!completedSync(status)) return;
      if (!syncStarted && status.lastSyncedAt === lastSyncedAt) return;

      syncStarted = false;
      lastSyncedAt = status.lastSyncedAt;
      window.dispatchEvent(new Event("offline-store:sync"));
      void refreshRoutes().catch(() => undefined);
    });
  }, [refreshRoutes, store]);

  return null;
}
