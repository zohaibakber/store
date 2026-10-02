import {
  rejectedCommandLabel,
  type InventorySyncActivity,
  type InventorySyncStatus,
} from "@store/client-db";

const inventorySyncStatusLabel = (status: InventorySyncStatus): string => {
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
    case "updateRequired":
      return `Update required. ${status.message}`;
    case "recoveryRequired":
      return status.message;
  }
};

const rejectionLabel = (activity: InventorySyncActivity): string | undefined => {
  const latest = activity.rejected[0];
  if (latest === undefined) return undefined;
  const { title, detail } = rejectedCommandLabel(latest);
  const others = activity.rejectedCount - 1;
  const reason = `${title}. ${detail}`;
  return others > 0 ? `${reason} ${others} more not saved.` : reason;
};

export const inventorySyncIssueLabel = (
  status: InventorySyncStatus,
  activity: InventorySyncActivity,
): string => {
  switch (status._tag) {
    case "rejected":
      return rejectionLabel(activity) ?? inventorySyncStatusLabel(status);
    case "savedLocally":
    case "pendingConfirmation":
    case "caughtUp":
    case "storageError":
    case "updateRequired":
    case "recoveryRequired":
      return inventorySyncStatusLabel(status);
  }
};
