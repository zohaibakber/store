import { SyncEntityChange, type SyncOperation } from "@store/contracts";
import { batches, stockMovements } from "@store/db/remote/schema";
import { and, eq, sum } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { SyncTransaction } from "./database.client";
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
    .limit(1)
    .for("update");
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
  const [batch] = yield* tx
    .update(batches)
    .set({
      packQuantity: Number(totals?.packQuantity ?? 0),
      unitQuantity: Number(totals?.unitQuantity ?? 0),
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
