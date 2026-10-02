import {
  rejectedCommandLabel,
  type CommandExecutionState,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type RejectedCommand,
} from "@store/inventory-react";

import { DAY_MS, formatCount, formatDateTime } from "../format";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type SyncTone = "synced" | "pending" | "attention" | "error";

type SyncHealthView = {
  readonly tone: SyncTone;
  readonly title: string;
  readonly detail: string;
  readonly canFix: boolean;
};

export const syncNeedsAttention = (status: InventorySyncStatus) =>
  status._tag === "rejected" ||
  status._tag === "storageError" ||
  status._tag === "updateRequired" ||
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
    case "updateRequired":
      return { tone: "error", title: "Update required", detail: status.message, canFix: false };
    case "recoveryRequired":
      return { tone: "error", title: "Needs recovery", detail: status.message, canFix: false };
  }
};

export type RejectedRowView = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly productId: string | null;
};

type SyncActivityView = {
  readonly pending: { readonly title: string; readonly detail: string };
  readonly lastSynced: { readonly title: string; readonly detail: string };
  readonly rejected: ReadonlyArray<RejectedRowView>;
  readonly hiddenRejected: number;
};

const lastSyncedLabel = (lastCaughtUpAt: number | null, now: number): string => {
  if (lastCaughtUpAt === null) return "Not synced on this phone yet";
  const elapsed = Math.max(0, now - lastCaughtUpAt);
  if (elapsed < MINUTE_MS) return "Synced just now";
  if (elapsed < HOUR_MS) return `Synced ${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `Synced ${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `Synced ${formatDateTime(lastCaughtUpAt)}`;
};

const pendingLabel = (count: number): string => {
  if (count === 0) return "Nothing waiting to upload";
  if (count === 1) return "1 change waiting to upload";
  return `${formatCount(count)} changes waiting to upload`;
};

const rejectedRowView = (rejected: RejectedCommand): RejectedRowView => {
  const label = rejectedCommandLabel(rejected);
  return {
    key: rejected.operationId,
    title: label.title,
    detail: label.detail,
    productId: rejected.productId,
  };
};

export const syncActivityView = (
  activity: InventorySyncActivity,
  now: number,
): SyncActivityView => ({
  pending: {
    title: pendingLabel(activity.pendingCount),
    detail:
      activity.pendingCount === 0
        ? "Every change on this phone has been sent."
        : "Saved on this phone. They upload when the server is reachable.",
  },
  lastSynced: {
    title: lastSyncedLabel(activity.lastCaughtUpAt, now),
    detail:
      activity.lastCaughtUpAt === null
        ? "Stock from other devices appears after the first sync."
        : "Stock from other devices is current as of then.",
  },
  rejected: activity.rejected.map(rejectedRowView),
  hiddenRejected: Math.max(0, activity.rejectedCount - activity.rejected.length),
});

export const firstFixableProduct = (activity: InventorySyncActivity): string | null =>
  activity.rejected.find((rejected) => rejected.productId !== null)?.productId ?? null;

export const unsyncedOperationId = (
  execution: CommandExecutionState,
  status: InventorySyncStatus,
): string | null => {
  if (status._tag !== "savedLocally" && status._tag !== "pendingConfirmation") return null;
  return execution._tag === "accepting" || execution._tag === "pending"
    ? execution.operationId
    : null;
};
