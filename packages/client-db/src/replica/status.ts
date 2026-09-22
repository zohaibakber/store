import type { CommandStatus } from "@store/contracts";

export type InventorySyncStatus =
  | { readonly _tag: "savedLocally" }
  | { readonly _tag: "pendingConfirmation" }
  | { readonly _tag: "caughtUp" }
  | { readonly _tag: "rejected"; readonly message: string }
  | { readonly _tag: "storageError"; readonly message: string };

export type InventoryCommandQueries = {
  readonly status: () => InventorySyncStatus;
};

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
