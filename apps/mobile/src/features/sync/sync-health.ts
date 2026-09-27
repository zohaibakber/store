import type { InventorySyncStatus } from "@store/client-db";

export type SyncTone = "synced" | "pending" | "attention" | "error";

export type SyncHealthView = {
  readonly tone: SyncTone;
  readonly title: string;
  readonly detail: string;
  readonly canFix: boolean;
};

export const syncNeedsAttention = (status: InventorySyncStatus) =>
  status._tag === "rejected" ||
  status._tag === "storageError" ||
  status._tag === "recoveryRequired";

export const syncHealthView = (status: InventorySyncStatus): SyncHealthView => {
  switch (status._tag) {
    case "caughtUp":
      return {
        tone: "synced",
        title: "Caught up",
        detail: "Every change on this phone is on the server.",
        canFix: false,
      };
    case "savedLocally":
      return {
        tone: "pending",
        title: "Saved on this phone",
        detail: "Saved here. They upload when the phone is online.",
        canFix: false,
      };
    case "pendingConfirmation":
      return {
        tone: "pending",
        title: "Uploading",
        detail: "Waiting for the server to confirm.",
        canFix: false,
      };
    case "rejected":
      return {
        tone: "attention",
        title: "A change was rejected",
        detail: status.message,
        canFix: true,
      };
    case "storageError":
      return { tone: "error", title: "Storage problem", detail: status.message, canFix: false };
    case "recoveryRequired":
      return { tone: "error", title: "Needs recovery", detail: status.message, canFix: false };
  }
};
