import type { SyncStatus } from "@store/contracts";
import { CloudSyncIcon, ReloadIcon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";

export function SyncButton() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    void window.offlineStore.getSyncStatus().then(setStatus);
  }, []);

  const sync = async () => {
    if (!status?.configured || isSyncing) return;

    setIsSyncing(true);
    try {
      setStatus(await window.offlineStore.sync());
    } catch {
      setStatus(await window.offlineStore.getSyncStatus());
    } finally {
      setIsSyncing(false);
      window.dispatchEvent(new Event("offline-store:sync"));
    }
  };

  const lastSynced = status?.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString()
    : "Never";

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Sync changes"
          disabled={!status?.configured || isSyncing}
          onClick={() => void sync()}
        >
          <HugeiconsIcon
            icon={isSyncing ? ReloadIcon : CloudSyncIcon}
            className={isSyncing ? "animate-spin" : undefined}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Last synced: {lastSynced}</TooltipContent>
    </Tooltip>
  );
}
