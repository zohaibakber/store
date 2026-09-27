import type { CommandExecutionState, InventorySyncStatus } from "@store/inventory-react";

export const unsyncedOperationId = (
  execution: CommandExecutionState,
  status: InventorySyncStatus,
): string | null => {
  if (status._tag !== "savedLocally" && status._tag !== "pendingConfirmation") return null;
  return execution._tag === "accepting" || execution._tag === "pending"
    ? execution.operationId
    : null;
};
