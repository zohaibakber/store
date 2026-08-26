import type { StockMovementRow } from "@store/client-db";
import { PowerSyncTransactor } from "@tanstack/powersync-db-collection";
import { createTransaction } from "@tanstack/react-db";

import type { Inventory, InventoryCollection } from "./types";

export const mutationMetadata = (actor: {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
}) => {
  const now = Date.now();
  return {
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: actor.deviceId,
    operationId: crypto.randomUUID(),
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as const;
};

export const updatedMetadata = (actor: {
  readonly userId: string;
  readonly deviceId: string;
  readonly rowVersion: number;
}) => ({
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: crypto.randomUUID(),
  rowVersion: actor.rowVersion + 1,
  updatedAt: Date.now(),
});

export const requiredRow = <Row,>(row: Row | undefined, label: string): Row => {
  if (!row) throw new Error(`${label} no longer exists.`);
  return row;
};

export const persistInsert = async <Row extends object>(
  collection: InventoryCollection<Row>,
  row: Row,
) => {
  const transaction = collection.insert(row);
  await transaction.isPersisted.promise;
};

/**
 * One PowerSync SQLite write for every collection mutation in `mutate`.
 * Direct `collection.insert` / `update` each open their own write, so a crash
 * between them can leave an invoice without stock movements (or the reverse).
 */
export const persistTogether = async (inventory: Inventory, mutate: () => void) => {
  const transaction = createTransaction({
    autoCommit: false,
    mutationFn: async ({ transaction: pending }) => {
      await new PowerSyncTransactor({ database: inventory.powerSync }).applyTransaction(pending);
    },
  });
  transaction.mutate(mutate);
  await transaction.commit();
  await transaction.isPersisted.promise;
};

export const activeRows = <Row extends { readonly deletedAt: number | null }>(rows: Iterable<Row>) =>
  [...rows].filter((row) => row.deletedAt === null);

export const movementRow = (
  actor: { readonly organizationId: string; readonly userId: string; readonly deviceId: string },
  input: Omit<
    StockMovementRow,
    "id" | "organizationId" | "actorUserId" | "deviceId" | "operationId" | "createdAt"
  >,
): StockMovementRow => ({
  id: crypto.randomUUID(),
  organizationId: actor.organizationId,
  actorUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: crypto.randomUUID(),
  createdAt: Date.now(),
  ...input,
});
