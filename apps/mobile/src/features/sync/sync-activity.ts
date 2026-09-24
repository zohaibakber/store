import type { InventorySyncActivity, RejectedCommand } from "@store/inventory-react";

import { formatCount, formatDateTime } from "../format";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type RejectedRowView = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly productId: string | null;
};

export type SyncActivityView = {
  readonly pending: { readonly title: string; readonly detail: string };
  readonly lastSynced: { readonly title: string; readonly detail: string };
  readonly rejected: ReadonlyArray<RejectedRowView>;
  readonly hiddenRejected: number;
};

const REASONS: ReadonlyMap<string, string> = new Map([
  ["INSUFFICIENT_STOCK", "Not enough stock"],
  ["ENTITY_CONFLICT", "Changed on another device"],
  ["ENTITY_RELATION_INVALID", "Linked item is missing"],
  ["ENTITY_WRITE_FAILED", "Couldn't be saved on the server"],
  ["INVOICE_IDENTITY_CONFLICT", "Invoice number already used"],
  ["IMPORT_IDENTITY_MISMATCH", "Import didn't match the catalog"],
  ["INVALID_OPERATION", "Not allowed"],
  ["COMMAND_ABANDONED", "Dropped"],
]);

const commandNoun = (rejected: RejectedCommand) =>
  rejected.command === "issueInvoice" ? "Sale" : "Stock change";

export const rejectionReason = (code: string) => REASONS.get(code) ?? "Rejected";

export const lastSyncedLabel = (lastCaughtUpAt: number | null, now: number): string => {
  if (lastCaughtUpAt === null) return "Not synced on this phone yet";
  const elapsed = Math.max(0, now - lastCaughtUpAt);
  if (elapsed < MINUTE_MS) return "Synced just now";
  if (elapsed < HOUR_MS) return `Synced ${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `Synced ${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `Synced ${formatDateTime(lastCaughtUpAt)}`;
};

export const pendingLabel = (count: number): string => {
  if (count === 0) return "Nothing waiting to upload";
  if (count === 1) return "1 change waiting to upload";
  return `${formatCount(count)} changes waiting to upload`;
};

export const rejectedRowView = (rejected: RejectedCommand): RejectedRowView => ({
  key: rejected.operationId,
  title: `${commandNoun(rejected)}: ${rejectionReason(rejected.code)}`,
  detail: rejected.message,
  productId: rejected.productId,
});

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
