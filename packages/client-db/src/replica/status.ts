import type { OutboxCommandStatus } from "./sqlite-row";

export type InventorySyncStatus =
  | { readonly _tag: "savedLocally" }
  | { readonly _tag: "pendingConfirmation" }
  | { readonly _tag: "caughtUp" }
  | { readonly _tag: "rejected"; readonly message: string }
  | { readonly _tag: "storageError"; readonly message: string };

export type InventoryCommandQueries = {
  readonly status: () => InventorySyncStatus;
};

export type SyncStatusStore = {
  readonly get: () => InventorySyncStatus;
  readonly set: (status: InventorySyncStatus) => void;
  readonly observe: (listener: (status: InventorySyncStatus) => void) => () => void;
};

export const syncStatusFromOutbox = (
  statuses: ReadonlyArray<OutboxCommandStatus>,
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

export const createSyncStatusStore = (initial: InventorySyncStatus): SyncStatusStore => {
  let current = initial;
  const listeners = new Set<(status: InventorySyncStatus) => void>();
  return {
    get: () => current,
    set: (status) => {
      current = status;
      for (const listener of listeners) listener(status);
    },
    observe: (listener) => {
      listeners.add(listener);
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
