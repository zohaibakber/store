import { compareCodeUnits } from "./canonical-json";
import type { SyncEntity, SyncEntityChange } from "./schema";

export const syncEntityDependencyOrder = {
  category: 0,
  product: 1,
  batch: 2,
  invoice: 2,
  invoiceItem: 3,
  stockMovement: 4,
} as const satisfies Record<SyncEntity, number>;

export const compareSyncEntityChanges = (left: SyncEntityChange, right: SyncEntityChange) =>
  syncEntityDependencyOrder[left.entity] - syncEntityDependencyOrder[right.entity] ||
  compareCodeUnits(left.entity, right.entity) ||
  compareCodeUnits(left.entityId, right.entityId);

export const orderSyncEntityChanges = (changes: ReadonlyArray<SyncEntityChange>) =>
  [...changes].sort(compareSyncEntityChanges);

export const syncEntityChangeKey = (change: SyncEntityChange) =>
  `${change.entity}\u0000${change.entityId}`;
