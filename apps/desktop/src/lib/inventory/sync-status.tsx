import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  DatabaseRestoreIcon,
  FileAttachmentIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { inventorySyncStatusLabel, type InventorySyncStatus } from "@store/inventory-react";

import { Badge } from "@/components/ui/badge";

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

const statusVariant = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "savedLocally":
      return "secondary" as const;
    case "pendingConfirmation":
      return "warning" as const;
    case "caughtUp":
      return "success" as const;
    case "rejected":
      return "error" as const;
    case "storageError":
      return "error" as const;
    case "recoveryRequired":
      return "warning" as const;
  }
};

export function InventorySyncStatusView({ status }: { readonly status: InventorySyncStatus }) {
  return (
    <div className="flex items-center border-b border-border px-4 py-1" role="status">
      <Badge size="sm" variant={statusVariant(status)}>
        <HugeiconsIcon aria-hidden="true" className="size-3" icon={statusIcon(status)} />
        <span>{inventorySyncStatusLabel(status)}</span>
      </Badge>
    </div>
  );
}
