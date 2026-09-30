import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  DatabaseRestoreIcon,
  FileAttachmentIcon,
  Upload01Icon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  inventorySyncStatusLabel,
  useCatalogIsReady,
  useInventoryActions,
  useInventorySyncStatus,
  type InventorySyncStatus,
} from "@store/inventory-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";

const statusIcon = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "savedLocally":
      return FileAttachmentIcon;
    case "pendingConfirmation":
      return Upload01Icon;
    case "caughtUp":
      return CheckmarkCircle02Icon;
    case "rejected":
      return Alert02Icon;
    case "storageError":
      return AlertCircleIcon;
    case "recoveryRequired":
      return DatabaseRestoreIcon;
  }
};

const statusTone = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "savedLocally":
      return "text-muted-foreground";
    case "pendingConfirmation":
      return "text-warning-foreground";
    case "caughtUp":
      return "text-success-foreground";
    case "rejected":
      return "text-destructive-foreground";
    case "storageError":
      return "text-destructive-foreground";
    case "recoveryRequired":
      return "text-warning-foreground";
  }
};

const statusShortLabel = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "savedLocally":
      return "Saved locally";
    case "pendingConfirmation":
      return "Syncing…";
    case "caughtUp":
      return "Synced";
    case "rejected":
      return "Sync rejected";
    case "storageError":
      return "Storage error";
    case "recoveryRequired":
      return "Needs recovery";
  }
};

function InventorySyncStatusView({
  online = true,
  onRetry,
  status,
}: {
  readonly online?: boolean;
  readonly onRetry?: () => void;
  readonly status: InventorySyncStatus;
}) {
  const label = inventorySyncStatusLabel(status);
  const offline = !online && (status._tag === "caughtUp" || status._tag === "pendingConfirmation");
  const shortLabel = offline ? "Offline" : statusShortLabel(status);
  const icon = offline ? WifiOff01Icon : statusIcon(status);
  const tone = offline ? "text-muted-foreground" : statusTone(status);
  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              aria-label={`Sync status: ${label}`}
              size="sm"
              tooltip={shortLabel}
            />
          }
        >
          <HugeiconsIcon aria-hidden="true" className={tone} icon={icon} />
          <span className="text-muted-foreground">{shortLabel}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto max-w-72" side="right">
          <div className="flex flex-col gap-1 text-sm" role="status">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                aria-hidden="true"
                className={cn("size-4 shrink-0", statusTone(status))}
                icon={statusIcon(status)}
              />
              <span>{label}</span>
            </div>
            {offline ? (
              <p className="text-xs text-muted-foreground">
                This device is offline. Changes are saved locally and sync when it reconnects.
              </p>
            ) : null}
            {status._tag === "recoveryRequired" && status.retryable === true && onRetry ? (
              <Button className="self-start" onClick={onRetry} size="xs" variant="outline">
                Retry
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

export function SidebarSyncStatus() {
  if (!useCatalogIsReady()) return null;
  return <ReadySyncStatus />;
}

function ReadySyncStatus() {
  const { retrySync } = useInventoryActions();
  return (
    <InventorySyncStatusView
      online={useOnline()}
      onRetry={() => {
        void retrySync().catch(() => undefined);
      }}
      status={useInventorySyncStatus()}
    />
  );
}
