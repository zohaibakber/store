import {
  Alert02Icon,
  AlertCircleIcon,
  DatabaseRestoreIcon,
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
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";

const attention = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "rejected":
      return { icon: Alert02Icon, tone: "text-destructive-foreground" };
    case "storageError":
      return { icon: AlertCircleIcon, tone: "text-destructive-foreground" };
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

function ReadySyncButton() {
  const { retrySync, syncNow } = useInventoryActions();
  const status = useInventorySyncStatus();
  return (
    <SyncButtonView
      onSync={
        status._tag === "recoveryRequired" && status.retryable === true
          ? () => void retrySync().catch(() => undefined)
          : syncNow
      }
      online={useOnline()}
      status={status}
      syncing={useInventorySyncing()}
    />
  );
}
