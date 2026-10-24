import type { CommandStatus } from "@store/contracts";
import type { ReplicaUnavailableReason } from "@store/contracts/replica";
import type { SyncPhase, SyncState } from "@store/sync";

export type InventorySyncStatus =
  | { readonly _tag: "savedLocally" }
  | { readonly _tag: "pendingConfirmation" }
  | { readonly _tag: "caughtUp" }
  | { readonly _tag: "rejected"; readonly message: string }
  | { readonly _tag: "storageError"; readonly message: string }
  | { readonly _tag: "updateRequired"; readonly message: string }
  | { readonly _tag: "recoveryRequired"; readonly message: string }
  | {
      readonly _tag: "unavailable";
      readonly reason: ReplicaUnavailableReason;
      readonly message: string;
    };

export type SyncTransfer = NonNullable<SyncState["transfer"]>;

export type ReplicaSyncHealth = (
  | { readonly _tag: "running"; readonly syncing?: boolean; readonly transfer?: SyncTransfer }
  | { readonly _tag: "storageError"; readonly message: string }
  | { readonly _tag: "updateRequired"; readonly message: string }
  | { readonly _tag: "recoveryRequired"; readonly message: string }
) & { readonly auth?: "refreshing" };

export const withAuthRefreshing = (
  health: ReplicaSyncHealth,
  refreshing: boolean,
): ReplicaSyncHealth => (refreshing ? { ...health, auth: "refreshing" } : health);

const UPDATE_REQUIRED_MESSAGE =
  "This version of the app is too old to sync. Update it to continue. Pending changes are saved on this device.";

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

const SYNCING_PHASES: ReadonlySet<SyncPhase> = new Set<SyncPhase>([
  "registering",
  "uploading",
  "catchingUp",
  "recovering",
]);

export const syncHealthOf = (state: SyncState): ReplicaSyncHealth => {
  const suspended = state.suspended;
  if (suspended === undefined) {
    const syncing = SYNCING_PHASES.has(state.phase);
    return state.transfer === undefined
      ? { _tag: "running", syncing }
      : { _tag: "running", syncing, transfer: state.transfer };
  }
  switch (suspended.reason) {
    case "storage":
      return { _tag: "storageError", message: suspended.message };
    case "updateRequired":
      return { _tag: "updateRequired", message: UPDATE_REQUIRED_MESSAGE };
    case "auth":
    case "garbledResponses":
    case "refused":
    case "protocol":
    case "recoveryRequired":
      return { _tag: "recoveryRequired", message: suspended.message };
  }
};

export const sameSyncHealth = (left: ReplicaSyncHealth, right: ReplicaSyncHealth): boolean => {
  if (left.auth !== right.auth) return false;
  if (left._tag === "running") {
    return (
      right._tag === "running" &&
      left.syncing === right.syncing &&
      left.transfer?.partsDone === right.transfer?.partsDone &&
      left.transfer?.partsTotal === right.transfer?.partsTotal
    );
  }
  return right._tag === left._tag && right.message === left.message;
};

export const syncStatusWithHealth = (
  outbox: InventorySyncStatus,
  health: ReplicaSyncHealth,
): InventorySyncStatus => (health._tag === "running" ? outbox : health);
