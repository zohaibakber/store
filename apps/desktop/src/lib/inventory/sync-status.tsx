import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  DatabaseRestoreIcon,
  FileAttachmentIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  inventorySyncStatusLabel,
  useCatalogIsReady,
  useInventorySyncStatus,
  type InventorySyncStatus,
} from "@store/inventory-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export function InventorySyncStatusView({ status }: { readonly status: InventorySyncStatus }) {
  const label = inventorySyncStatusLabel(status);
  return (
    <Popover>
      <PopoverTrigger
        render={<Button aria-label={`Sync status: ${label}`} size="icon-sm" variant="ghost" />}
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={statusTone(status)}
          icon={statusIcon(status)}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-72">
        <div className="flex items-center gap-2 text-sm" role="status">
          <HugeiconsIcon
            aria-hidden="true"
            className={cn("size-4 shrink-0", statusTone(status))}
            icon={statusIcon(status)}
          />
          <span>{label}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function HeaderSyncStatus() {
  if (!useCatalogIsReady()) return null;
  return <ReadySyncStatus />;
}

function ReadySyncStatus() {
  return <InventorySyncStatusView status={useInventorySyncStatus()} />;
}
