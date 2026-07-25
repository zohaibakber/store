import type { SyncEntity, SyncEntityChange, SyncOperation } from "@store/contracts";
import { syncEntityPushRows } from "@store/contracts/entity-rows";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { protocolError } from "./errors";
import type { SyncActor } from "./model";

export const decodeEntityRow = <E extends SyncEntity>(
  entity: E,
  change: SyncEntityChange,
): Effect.Effect<(typeof syncEntityPushRows)[E]["Type"], ReturnType<typeof protocolError>> =>
  Effect.gen(function* () {
    const row = yield* Schema.decodeUnknownEffect(syncEntityPushRows[entity])(change.row).pipe(
      Effect.mapError((error) =>
        protocolError(
          "INVALID_ENTITY_ROW",
          `${change.entity} ${change.entityId} has an invalid row: ${error.message}`,
        ),
      ),
    );
    if (row.id !== change.entityId)
      return yield* Effect.fail(
        protocolError(
          "ENTITY_ID_MISMATCH",
          `${change.entity} row id does not match its change id.`,
        ),
      );
    return row as (typeof syncEntityPushRows)[E]["Type"];
  });

export const serverOwnedColumns = (
  actor: SyncActor,
  operation: SyncOperation,
  change: SyncEntityChange,
  row: { readonly createdAt?: number },
  current:
    | { readonly createdAt: number; readonly createdByUserId: string; readonly rowVersion: number }
    | undefined,
) => ({
  id: change.entityId,
  organizationId: actor.organizationId,
  createdAt: current?.createdAt ?? row.createdAt ?? operation.occurredAt,
  updatedAt: operation.occurredAt,
  deletedAt: change.action === "delete" ? operation.occurredAt : null,
  createdByUserId: current?.createdByUserId ?? actor.userId,
  updatedByUserId: actor.userId,
  deviceId: operation.deviceId,
  operationId: operation.operationId,
  rowVersion: Math.max(change.rowVersion, (current?.rowVersion ?? 0) + 1, 1),
});
