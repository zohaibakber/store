import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  FileAttachmentIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InventorySyncStatus } from "@store/client-db";

import { Badge } from "@/components/ui/badge";

const statusLabel = (status: InventorySyncStatus): string => {
  switch (status._tag) {
    case "savedLocally":
      return "Saved locally";
    case "pendingConfirmation":
      return "Pending confirmation";
    case "caughtUp":
      return "Caught up";
    case "rejected":
      return status.message;
    case "storageError":
      return status.message;
  }
};

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
  }
};

export function InventorySyncStatusView({ status }: { readonly status: InventorySyncStatus }) {
  return (
    <div className="flex items-center border-b border-border px-4 py-1" role="status">
      <Badge size="sm" variant={statusVariant(status)}>
        <HugeiconsIcon aria-hidden="true" className="size-3" icon={statusIcon(status)} />
        <span>{statusLabel(status)}</span>
      </Badge>
    </div>
  );
}
