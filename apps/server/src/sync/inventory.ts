import { SyncEntityChange, type SyncOperation } from "@store/contracts";
import { batches, stockMovements } from "@store/db/do/schema";
import { and, eq, sum } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { SyncTransaction } from "./database";
import { protocolError } from "./errors";
import type { SyncActor } from "./model";

export const reconcileBatch = Effect.fn("SyncDatabase.reconcileBatch")(function* (
  tx: SyncTransaction,
  actor: SyncActor,
  operation: SyncOperation,
  batchId: string,
) {
  const [current] = yield* tx
    .select({ rowVersion: batches.rowVersion })
    .from(batches)
    .where(and(eq(batches.organizationId, actor.organizationId), eq(batches.id, batchId)))
    .limit(1);
  if (!current)
    return yield* Effect.fail(
      protocolError("BATCH_NOT_FOUND", "A stock movement refers to a missing batch."),
    );

  const [totals] = yield* tx
    .select({
      packQuantity: sum(stockMovements.packDelta),
      unitQuantity: sum(stockMovements.unitDelta),
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, actor.organizationId),
        eq(stockMovements.batchId, batchId),
      ),
    );
  const packQuantity = Number(totals?.packQuantity ?? 0);
  const unitQuantity = Number(totals?.unitQuantity ?? 0);
  if (
    !Number.isSafeInteger(packQuantity) ||
    !Number.isSafeInteger(unitQuantity) ||
    packQuantity < 0 ||
    unitQuantity < 0
  )
    return yield* Effect.fail(
      protocolError("ENTITY_CONFLICT", "A stock movement would make inventory negative."),
    );
  const [batch] = yield* tx
    .update(batches)
    .set({
      packQuantity,
      unitQuantity,
      updatedAt: operation.occurredAt,
      updatedByUserId: actor.userId,
      deviceId: operation.deviceId,
      operationId: operation.operationId,
      rowVersion: current.rowVersion + 1,
    })
    .where(and(eq(batches.organizationId, actor.organizationId), eq(batches.id, batchId)))
    .returning();
  if (!batch)
    return yield* Effect.fail(
      protocolError("BATCH_NOT_FOUND", "A stock movement refers to a missing batch."),
    );
  return SyncEntityChange.make({
    entity: "batch",
    action: batch.deletedAt === null ? "upsert" : "delete",
    entityId: batch.id,
    rowVersion: batch.rowVersion,
    row: batch,
  });
});
