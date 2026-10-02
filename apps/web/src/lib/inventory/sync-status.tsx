import { useAtom } from "@effect/atom-react";
import {
  Alert02Icon,
  AlertCircleIcon,
  Cancel01Icon,
  DatabaseRestoreIcon,
  DownloadCircle01Icon,
  RefreshCwIcon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  inventorySyncIssueLabel,
  useCatalogIsReady,
  useInventoryActions,
  useInventorySyncActivity,
  useInventorySyncing,
  useInventorySyncStatus,
  type InventorySyncActivity,
  type InventorySyncStatus,
} from "@store/inventory-react";
import { useState } from "react";

import { SidebarMenuAction } from "@/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { canCheckForAppUpdate, useCheckForAppUpdate } from "@/hooks/use-app-updater";
import { useOnline } from "@/hooks/use-online";
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
      return { icon: DatabaseRestoreIcon, tone: "text-warning-foreground" };
    case "savedLocally":
    case "pendingConfirmation":
    case "caughtUp":
      return null;
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

type SyncIssue = NonNullable<ReturnType<typeof attention>>;

function SyncButtonView({
  online,
  issue,
  issueLabel,
  syncing,
  onSync,
}: {
  readonly online: boolean;
  readonly issue: SyncIssue | null;
  readonly issueLabel: string;
  readonly syncing: boolean;
  readonly onSync: () => void;
}) {
  const [spinning, setSpinning] = useState(false);
  if (syncing && !spinning) setSpinning(true);
  const label = issue
    ? issueLabel
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

export function OnDeviceAction() {
  if (!useCatalogIsReady()) return null;
  return <ReadyOnDeviceAction />;
}

function OnDeviceActionButton({
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
          <SidebarMenuAction
            aria-label={label}
            className="peer-data-[size=lg]/menu-button:top-3.5"
            disabled={busy}
            onClick={onClick}
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(tone, busy && "animate-spin")}
          icon={icon}
        />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ReadyOnDeviceAction() {
  const { retrySync } = useInventoryActions();
  const { status, dismissible, dismiss } = useSyncIssue();
  const [retrying, setRetrying] = useState(false);
  if (dismissible) {
    return (
      <OnDeviceActionButton
        icon={Cancel01Icon}
        label="Dismiss"
        onClick={dismiss}
        tone="text-muted-foreground"
      />
    );
  }
  if (status._tag !== "recoveryRequired" || status.retryable !== true) return null;
  const retry = () => {
    setRetrying(true);
    void retrySync()
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };
  return (
    <OnDeviceActionButton
      busy={retrying}
      icon={RefreshCwIcon}
      label="Try again"
      onClick={retry}
      tone="text-warning-foreground"
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

function ReadySyncButton() {
  const { retrySync, syncNow } = useInventoryActions();
  const checkForAppUpdate = useCheckForAppUpdate();
  const { status, issue, label, dismissible, dismiss } = useSyncIssue();
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
        return () => {
          dismiss();
          syncNow();
        };
      case "storageError":
      case "savedLocally":
      case "pendingConfirmation":
      case "caughtUp":
        return syncNow;
    }
  };
  return (
    <SyncButtonView
      issue={issue}
      issueLabel={dismissible ? `${label} Click to dismiss.` : label}
      onSync={action()}
      online={useOnline()}
      syncing={useInventorySyncing()}
    />
  );
}
