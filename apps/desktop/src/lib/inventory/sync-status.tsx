import {
  Alert02Icon,
  AlertCircleIcon,
  DatabaseRestoreIcon,
  DownloadCircle01Icon,
  RefreshCwIcon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  inventorySyncStatusLabel,
  useCatalogIsReady,
  useInventoryActions,
  useInventorySyncing,
  useInventorySyncStatus,
  type InventorySyncStatus,
} from "@store/inventory-react";
import { useState } from "react";

import { SidebarMenuAction } from "@/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { canCheckForAppUpdate, useCheckForAppUpdate } from "@/hooks/use-app-updater";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";

const attention = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "rejected":
      return { icon: Alert02Icon, tone: "text-destructive-foreground" };
    case "storageError":
      return { icon: AlertCircleIcon, tone: "text-destructive-foreground" };
    case "updateRequired":
      return { icon: DownloadCircle01Icon, tone: "text-warning-foreground" };
    case "recoveryRequired":
      return { icon: DatabaseRestoreIcon, tone: "text-warning-foreground" };
    case "savedLocally":
    case "pendingConfirmation":
    case "caughtUp":
      return null;
  }
};

function SyncButtonView({
  online,
  status,
  syncing,
  onSync,
}: {
  readonly online: boolean;
  readonly status: InventorySyncStatus;
  readonly syncing: boolean;
  readonly onSync: () => void;
}) {
  const [spinning, setSpinning] = useState(false);
  if (syncing && !spinning) setSpinning(true);
  const issue = attention(status);
  const label = issue
    ? inventorySyncStatusLabel(status)
    : !online
      ? "Offline. Changes sync when this device reconnects."
      : syncing
        ? "Syncing…"
        : "Sync now";
  const icon = issue?.icon ?? (online ? RefreshCwIcon : WifiOff01Icon);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuAction
            aria-label={label}
            className="peer-data-[size=lg]/menu-button:top-3.5"
            onAnimationIteration={() => {
              if (!syncing) setSpinning(false);
            }}
            onClick={onSync}
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(
            issue?.tone ?? "text-muted-foreground",
            !issue && online && spinning && "animate-spin",
          )}
          icon={icon}
        />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function SidebarSyncButton() {
  if (!useCatalogIsReady()) return null;
  return <ReadySyncButton />;
}

export function OnDeviceStatus() {
  if (!useCatalogIsReady()) return null;
  return <ReadyOnDeviceStatus />;
}

export function OnDeviceRetry() {
  if (!useCatalogIsReady()) return null;
  return <ReadyOnDeviceRetry />;
}

function ReadyOnDeviceRetry() {
  const { retrySync } = useInventoryActions();
  const status = useInventorySyncStatus();
  const [retrying, setRetrying] = useState(false);
  if (status._tag !== "recoveryRequired" || status.retryable !== true) return null;
  const retry = () => {
    setRetrying(true);
    void retrySync()
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuAction
            aria-label="Try again"
            className="peer-data-[size=lg]/menu-button:top-3.5"
            disabled={retrying}
            onClick={retry}
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={cn("text-warning-foreground", retrying && "animate-spin")}
          icon={RefreshCwIcon}
        />
      </TooltipTrigger>
      <TooltipPopup side="right">Try again</TooltipPopup>
    </Tooltip>
  );
}

function ReadyOnDeviceStatus() {
  const status = useInventorySyncStatus();
  const issue = attention(status);
  return (
    <span className={cn("truncate text-xs", issue?.tone ?? "text-muted-foreground")} role="status">
      {issue ? inventorySyncStatusLabel(status) : "Saved on this device"}
    </span>
  );
}

function ReadySyncButton() {
  const { retrySync, syncNow } = useInventoryActions();
  const checkForAppUpdate = useCheckForAppUpdate();
  const status = useInventorySyncStatus();
  const applyUpdate = () => {
    if (canCheckForAppUpdate()) checkForAppUpdate();
    else window.location.reload();
  };
  const retry = () => void retrySync().catch(() => undefined);
  const action = (): (() => void) => {
    switch (status._tag) {
      case "updateRequired":
        return applyUpdate;
      case "recoveryRequired":
        return status.retryable === true ? retry : syncNow;
      case "rejected":
      case "storageError":
      case "savedLocally":
      case "pendingConfirmation":
      case "caughtUp":
        return syncNow;
    }
  };
  return (
    <SyncButtonView
      onSync={action()}
      online={useOnline()}
      status={status}
      syncing={useInventorySyncing()}
    />
  );
}
