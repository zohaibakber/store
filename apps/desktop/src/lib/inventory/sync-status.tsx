import { useAtom } from "@effect/atom-react";
import {
  Alert02Icon,
  AlertCircleIcon,
  DatabaseRestoreIcon,
  DownloadCircle01Icon,
  RefreshCwIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  inventorySyncIssueLabel,
  useCatalogIsReady,
  useCommand,
  useInventorySyncActivity,
  useInventorySyncStatus,
  type InventorySyncActivity,
  type InventorySyncStatus,
} from "@store/inventory-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useCheckForAppUpdate } from "@/hooks/use-app-updater";
import { acknowledgedRejectionsAtom } from "@/lib/preferences";
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
    case "unavailable":
      return { icon: DatabaseRestoreIcon, tone: "text-warning-foreground" };
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

const MAX_ACKNOWLEDGED_REJECTIONS = 16;

const rejectionKey = (activity: InventorySyncActivity) =>
  activity.rejected[0]?.operationId ?? `unnamed:${activity.rejectedCount}`;

const useSyncIssue = () => {
  const status = useInventorySyncStatus();
  const activity = useInventorySyncActivity();
  const [acknowledged, setAcknowledged] = useAtom(acknowledgedRejectionsAtom);
  const key = rejectionKey(activity);
  const dismissed = status._tag === "rejected" && acknowledged.includes(key);
  return {
    status,
    issue: dismissed ? null : attention(status),
    label: inventorySyncIssueLabel(status, activity),
    dismissible: status._tag === "rejected" && !dismissed,
    dismiss: () =>
      setAcknowledged((current) =>
        current.includes(key) ? current : [...current, key].slice(-MAX_ACKNOWLEDGED_REJECTIONS),
      ),
  };
};

export function WorkspaceSyncAction() {
  if (!useCatalogIsReady()) return null;
  return <ReadySyncAction />;
}

export function OnDeviceStatus() {
  if (!useCatalogIsReady()) return null;
  return <ReadyOnDeviceStatus />;
}

function SyncActionButton({
  label,
  icon,
  tone,
  busy = false,
  onClick,
}: {
  readonly label: string;
  readonly icon: IconSvgElement;
  readonly tone: string;
  readonly busy?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={busy}
            onClick={onClick}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(tone, busy && "animate-spin")}
          icon={icon}
        />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ReadySyncAction() {
  const [retrySync, retrying] = useCommand((commands) => commands.retrySync);
  const checkForAppUpdate = useCheckForAppUpdate();
  const { status, issue, label, dismissible, dismiss } = useSyncIssue();
  const retry = () => void retrySync();
  if (issue === null) return null;
  if (dismissible) {
    return (
      <SyncActionButton
        icon={issue.icon}
        label={`${label} Click to dismiss.`}
        onClick={dismiss}
        tone={issue.tone}
      />
    );
  }
  if (status._tag === "updateRequired") {
    return (
      <SyncActionButton
        icon={issue.icon}
        label={label}
        onClick={checkForAppUpdate}
        tone={issue.tone}
      />
    );
  }
  if (!retryable(status)) {
    return (
      <SyncActionButton busy icon={RefreshCwIcon} label={label} onClick={retry} tone={issue.tone} />
    );
  }
  return (
    <SyncActionButton
      busy={retrying}
      icon={retrying ? RefreshCwIcon : issue.icon}
      label={`${label} Click to try again.`}
      onClick={retry}
      tone={issue.tone}
    />
  );
}

function ReadyOnDeviceStatus() {
  const { issue, label } = useSyncIssue();
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
