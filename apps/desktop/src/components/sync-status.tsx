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
import { formatRelativeTime } from "@/lib/format";

/**
 * The sidebar's connection line: cloud-connected, offline, or mid-sync. Clicking
 * it forces a sync when one is configured.
 */
export function SyncStatusIndicator() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

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
    if (!status?.configured || isSyncing) return;
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

  const online = status?.configured === true && status.phase !== "error";
  const label = isSyncing
    ? "Syncing…"
    : status?.configured
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
            aria-label={`${label}. ${lastSynced}.`}
            className="w-full justify-start gap-2 text-muted-foreground"
            disabled={!status?.configured || isSyncing}
            onClick={() => void sync()}
            size="sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={isSyncing ? "animate-spin" : undefined}
          icon={isSyncing ? ReloadIcon : online ? CellularNetworkIcon : CellularNetworkOfflineIcon}
        />
        <span className="truncate">{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {status?.message ?? "Checking the local database…"} · {lastSynced}
      </TooltipPopup>
    </Tooltip>
  );
}
