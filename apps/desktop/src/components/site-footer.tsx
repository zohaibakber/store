import type { SyncStatus } from "@store/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CloudSyncIcon, Loading03Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function SiteFooter() {
  const { toggleSidebar } = useSidebar();
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
    <footer className="z-50 flex w-full items-center border-t bg-background">
      <div className="flex h-(--footer-height) w-full items-center px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
        >
          <HugeiconsIcon icon={SidebarLeftIcon} />
        </Button>
        <Tooltip>
          <TooltipTrigger render={<span className="ml-auto inline-flex" />}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Sync changes"
              disabled={!status?.configured || isSyncing}
              onClick={sync}
            >
              <HugeiconsIcon
                icon={isSyncing ? Loading03Icon : CloudSyncIcon}
                className={isSyncing ? "animate-spin" : undefined}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Last synced: {lastSynced}</TooltipContent>
        </Tooltip>
      </div>
    </footer>
  );
}
