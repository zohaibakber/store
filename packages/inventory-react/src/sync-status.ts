import type { InventorySyncStatus } from "@store/client-db";

export const inventorySyncStatusLabel = (status: InventorySyncStatus): string => {
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
    case "recoveryRequired":
      return status.message;
  }
};
