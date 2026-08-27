import type { SyncEntity, SyncEntityChange } from "@store/contracts";
import { syncEntityPushRows } from "@store/contracts/entity-rows";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { inventoryProtocolError } from "./errors";
import type { InventoryActor } from "./model";

export const decodeEntityRow = <E extends SyncEntity>(
  entity: E,
  change: SyncEntityChange,
): Effect.Effect<
  (typeof syncEntityPushRows)[E]["Type"],
  ReturnType<typeof inventoryProtocolError>
> =>
  Effect.gen(function* () {
    const row = yield* Schema.decodeUnknownEffect(syncEntityPushRows[entity])(change.row).pipe(
      Effect.mapError((error) =>
        inventoryProtocolError(
          "INVALID_ENTITY_ROW",
          `${change.entity} ${change.entityId} has an invalid row: ${error.message}`,
        ),
      ),
    );
    if (row.id !== change.entityId)
      return yield* Effect.fail(
        inventoryProtocolError(
          "ENTITY_ID_MISMATCH",
          `${change.entity} row id does not match its change id.`,
        ),
      );
    // SAFETY: The row was decoded with the schema selected by the same entity key E.
    return row as (typeof syncEntityPushRows)[E]["Type"];
  });

export type CatalogWriteStamp = {
  readonly occurredAt: number;
  readonly deviceId: string;
  readonly operationId: string;
};

export const serverOwnedColumns = (
  actor: InventoryActor,
  write: CatalogWriteStamp,
  change: SyncEntityChange,
  row: { readonly createdAt?: number },
  current:
    | { readonly createdAt: number; readonly createdByUserId: string; readonly rowVersion: number }
    | undefined,
) => ({
  id: change.entityId,
  organizationId: actor.organizationId,
  createdAt: current?.createdAt ?? row.createdAt ?? write.occurredAt,
  updatedAt: write.occurredAt,
  deletedAt: change.action === "delete" ? write.occurredAt : null,
  createdByUserId: current?.createdByUserId ?? actor.userId,
  updatedByUserId: actor.userId,
  deviceId: write.deviceId,
  operationId: write.operationId,
  rowVersion: Math.max(change.rowVersion, (current?.rowVersion ?? 0) + 1, 1),
});
