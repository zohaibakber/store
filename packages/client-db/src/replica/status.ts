import type { CommandStatus } from "@store/contracts";
import type { SyncSchedulerStatus } from "@store/sync/browser";

export type InventorySyncStatus =
  | { readonly _tag: "savedLocally" }
  | { readonly _tag: "pendingConfirmation" }
  | { readonly _tag: "caughtUp" }
  | { readonly _tag: "rejected"; readonly message: string }
  | { readonly _tag: "storageError"; readonly message: string }
  | { readonly _tag: "recoveryRequired"; readonly message: string };

export type ReplicaSyncHealth =
  | { readonly _tag: "running" }
  | { readonly _tag: "storageError"; readonly message: string }
  | { readonly _tag: "recoveryRequired"; readonly message: string };

export const syncStatusFromOutbox = (
  statuses: ReadonlyArray<CommandStatus>,
): InventorySyncStatus => {
  if (statuses.includes("rejected")) {
    return { _tag: "rejected", message: "The authority rejected a local command." };
  }
  if (statuses.includes("accepted_awaiting_integration") || statuses.includes("sending")) {
    return { _tag: "pendingConfirmation" };
  }
  if (statuses.includes("pending")) return { _tag: "savedLocally" };
  return { _tag: "caughtUp" };
};

export const syncHealthFromScheduler = (status: SyncSchedulerStatus): ReplicaSyncHealth => {
  switch (status._tag) {
    case "storageError":
      return { _tag: "storageError", message: status.message };
    case "recoveryRequired":
      return { _tag: "recoveryRequired", message: status.message };
    case "running":
    case "pausedForAuth":
    case "stopped":
      return { _tag: "running" };
  }
};

export const syncStatusWithHealth = (
  outbox: InventorySyncStatus,
  health: ReplicaSyncHealth,
): InventorySyncStatus => (health._tag === "running" ? outbox : health);
