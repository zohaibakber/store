import type { SyncStatus } from "@store/contracts";
import {
  CellularNetworkIcon,
  CellularNetworkOfflineIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnline } from "@/hooks/use-online";
import { formatRelativeTime } from "@/lib/format";

/**
 * The sidebar's connection line: cloud-connected, offline, or mid-sync. Clicking
 * it forces a sync when one is configured.
 */
export function SyncStatusIndicator() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const isOnline = useOnline();

  const refresh = useCallback(async () => {
    setStatus(await window.offlineStore.getSyncStatus());
  }, []);

  useEffect(() => {
    void refresh();
    const onSync = () => void refresh();
    window.addEventListener("offline-store:sync", onSync);
    return () => window.removeEventListener("offline-store:sync", onSync);
  }, [refresh]);

  const sync = async () => {
    if (!isOnline || !status?.configured || isSyncing) return;
    setIsSyncing(true);
    try {
      setStatus(await window.offlineStore.sync());
    } catch {
      await refresh();
    } finally {
      setIsSyncing(false);
      window.dispatchEvent(new Event("offline-store:sync"));
    }
  };

  const connectionLabel = isSyncing ? "Syncing…" : isOnline ? "Online" : "Offline";
  const syncLabel = status?.configured
    ? status.phase === "error"
      ? "Sync paused"
      : "Cloud ready"
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
            variant="ghost"
          />
        }
      >
        {isSyncing ? (
          <HugeiconsIcon aria-hidden="true" className="animate-spin" icon={ReloadIcon} />
        ) : (
          <HugeiconsIcon
            aria-hidden="true"
            icon={isOnline ? CellularNetworkIcon : CellularNetworkOfflineIcon}
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {connectionLabel} · {syncLabel} · {lastSynced}
      </TooltipPopup>
    </Tooltip>
  );
}
