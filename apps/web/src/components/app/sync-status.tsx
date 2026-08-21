import { ReloadIcon, Wifi01Icon, WifiOff01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { syncConfigured, type SyncStatus } from "@store/contracts/sync.schema";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnline } from "@/hooks/use-online";
import { formatRelativeTime } from "@/lib/format";
import { useStore } from "@/lib/store";

export function SyncStatusIndicator() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const store = useStore();
  const isOnline = useOnline();
  const isSyncing = status?.phase === "syncing";

  const refresh = useCallback(
    () => store.getSyncStatus().then((nextStatus) => setStatus(nextStatus)),
    [store],
  );

  useEffect(() => {
    void refresh();
    const onSync = () => void refresh();
    const unsubscribe = store.onSyncStatusChange(setStatus);
    window.addEventListener("offline-store:sync", onSync);
    return () => {
      unsubscribe();
      window.removeEventListener("offline-store:sync", onSync);
    };
  }, [refresh, store]);

  const sync = async () => {
    if (!isOnline || !status || !syncConfigured(status) || isSyncing) return;
    setStatus((current) =>
      current
        ? {
            ...current,
            phase: "syncing",
            message: "Synchronizing local and cloud changes…",
          }
        : current,
    );
    try {
      setStatus(await store.sync());
    } catch {
      await refresh().catch(() => undefined);
    }
    window.dispatchEvent(new Event("offline-store:sync"));
  };

  const connectionLabel = isSyncing ? "Syncing…" : isOnline ? "Online" : "Offline";
  const syncLabel = status
    ? syncConfigured(status)
      ? status.phase === "error"
        ? "Sync paused"
        : "Cloud ready"
      : "Local only"
    : "Local only";
  const lastSynced = status?.lastSyncedAt
    ? `Last sync ${formatRelativeTime(status.lastSyncedAt)}`
    : "Never synced";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`${connectionLabel}. ${syncLabel}. ${lastSynced}.`}
            disabled={isSyncing}
            onClick={() => void sync()}
            size="icon-xs"
            type="button"
            variant="outline"
          />
        }
      >
        {isSyncing ? (
          <HugeiconsIcon aria-hidden="true" className="animate-spin" icon={ReloadIcon} />
        ) : (
          <HugeiconsIcon aria-hidden="true" icon={isOnline ? Wifi01Icon : WifiOff01Icon} />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {connectionLabel} · {syncLabel} · {lastSynced}
      </TooltipPopup>
    </Tooltip>
  );
}
