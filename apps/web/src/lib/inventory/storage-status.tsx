import { AlertCircleIcon, DatabaseRestoreIcon, RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  inventorySyncIssueLabel,
  useCatalogIsReady,
  useInventoryActions,
  useInventorySyncActivity,
  useInventorySyncStatus,
  type InventorySyncStatus,
} from "@store/inventory-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const attention = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "storageError":
      return { icon: AlertCircleIcon, tone: "text-destructive-foreground" };
    case "recoveryRequired":
    case "unavailable":
      return { icon: DatabaseRestoreIcon, tone: "text-warning-foreground" };
    case "rejected":
    case "updateRequired":
    case "savedLocally":
    case "pendingConfirmation":
    case "caughtUp":
      return null;
  }
};

const retryable = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "recoveryRequired":
    case "storageError":
      return true;
    case "unavailable":
      return status.reason === "exhausted";
    case "rejected":
    case "updateRequired":
    case "savedLocally":
    case "pendingConfirmation":
    case "caughtUp":
      return false;
  }
};

const useStorageIssue = () => {
  const status = useInventorySyncStatus();
  const activity = useInventorySyncActivity();
  return {
    status,
    issue: attention(status),
    label: inventorySyncIssueLabel(status, activity),
  };
};

export function StorageRecoveryAction() {
  if (!useCatalogIsReady()) return null;
  return <ReadyRecoveryAction />;
}

export function OnDeviceStatus() {
  if (!useCatalogIsReady()) return null;
  return <ReadyOnDeviceStatus />;
}

function ReadyRecoveryAction() {
  const { retrySync } = useInventoryActions();
  const { status, issue, label } = useStorageIssue();
  const [retrying, setRetrying] = useState(false);
  if (issue === null) return null;
  const waiting = !retryable(status);
  const busy = waiting || retrying;
  const retry = () => {
    setRetrying(true);
    void retrySync()
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };
  const text = waiting ? label : `${label} Click to try again.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={text}
            disabled={busy}
            onClick={retry}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(issue.tone, busy && "animate-spin")}
          icon={busy ? RefreshCwIcon : issue.icon}
        />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{text}</TooltipPopup>
    </Tooltip>
  );
}

function ReadyOnDeviceStatus() {
  const { issue, label } = useStorageIssue();
  return (
    <span
      className={cn("truncate text-xs", issue?.tone ?? "text-muted-foreground")}
      role="status"
      title={issue ? label : undefined}
    >
      {issue ? label : "Saved on this device"}
    </span>
  );
}
