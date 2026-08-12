import {
  compareSyncEntityChanges,
  SyncAck,
  SyncEntityChange,
  syncEntityChangeKey,
  type SyncOperation,
} from "@store/contracts";
import { batches, syncChangeLog, syncInbox } from "@store/db/do/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { applyChange } from "./apply-change";
import type { SyncTransaction } from "./database";
import { protocolError } from "./errors";
import { reconcileBatch } from "./inventory";
import type { SyncActor } from "./model";
import { decodeEntityRow } from "./row-validation";

const MOBILE_STOCK_CORRECTION_NOTE = "Stock corrected from mobile scanner";

const assertMobileStockCorrectionVersion = Effect.fn(
  "SyncDatabase.assertMobileStockCorrectionVersion",
)(function* (tx: SyncTransaction, actor: SyncActor, operation: SyncOperation) {
  for (const movementChange of operation.changes) {
    if (movementChange.entity !== "stockMovement" || movementChange.action !== "upsert") continue;
    const movement = yield* decodeEntityRow("stockMovement", movementChange);
    if (movement.note !== MOBILE_STOCK_CORRECTION_NOTE) continue;

    const batchChange = operation.changes.find(
      (change) =>
        change.entity === "batch" &&
        change.action === "upsert" &&
        change.entityId === movement.batchId,
    );
    if (!batchChange)
      return yield* Effect.fail(
        protocolError("INVALID_ENTITY_ROW", "A stock correction must include its batch."),
      );

    const [current] = yield* tx
      .select({ rowVersion: batches.rowVersion })
      .from(batches)
      .where(
        and(eq(batches.organizationId, actor.organizationId), eq(batches.id, movement.batchId)),
      )
      .limit(1);
    if (current && batchChange.rowVersion !== current.rowVersion + 1)
      return yield* Effect.fail(
        protocolError(
          "ENTITY_CONFLICT",
          "Stock changed on another device. Review the latest count and try again.",
        ),
      );
  }
});

export const applyOperation = Effect.fn("SyncDatabase.applyOperation")(function* (
  tx: SyncTransaction,
  actor: SyncActor,
  operation: SyncOperation,
) {
  const [sequenceReceipt] = yield* tx
    .select({ operationId: syncInbox.operationId })
    .from(syncInbox)
    .where(
      and(
        eq(syncInbox.organizationId, actor.organizationId),
        eq(syncInbox.deviceId, operation.deviceId),
        eq(syncInbox.clientSequence, operation.clientSequence),
      ),
    )
    .limit(1);
  if (sequenceReceipt && sequenceReceipt.operationId !== operation.operationId)
    return yield* Effect.fail(
      protocolError(
        "CLIENT_SEQUENCE_REUSED",
        "A device sequence was reused by a different operation.",
      ),
    );

  const claimed = yield* tx
    .insert(syncInbox)
    .values({
      organizationId: actor.organizationId,
      operationId: operation.operationId,
      deviceId: operation.deviceId,
      actorUserId: actor.userId,
      clientSequence: operation.clientSequence,
      payloadHash: operation.payloadHash,
      appliedCursor: 0,
      receivedAt: Date.now(),
    })
    .onConflictDoNothing({ target: [syncInbox.organizationId, syncInbox.operationId] })
    .returning({ operationId: syncInbox.operationId });

  if (claimed.length === 0) {
    const [existing] = yield* tx
      .select({ payloadHash: syncInbox.payloadHash, appliedCursor: syncInbox.appliedCursor })
      .from(syncInbox)
      .where(
        and(
          eq(syncInbox.organizationId, actor.organizationId),
          eq(syncInbox.operationId, operation.operationId),
        ),
      )
      .limit(1);
    if (!existing)
      return yield* Effect.fail(
        protocolError("OPERATION_COLLISION", "The operation sequence is already in use."),
      );
    if (existing.payloadHash !== operation.payloadHash)
      return yield* Effect.fail(
        protocolError("OPERATION_ID_REUSED", "An operation id was reused with different content."),
      );
    return SyncAck.make({
      operationId: operation.operationId,
      status: "duplicate",
      cursor: existing.appliedCursor,
    });
  }

  yield* assertMobileStockCorrectionVersion(tx, actor, operation);

  const canonicalChanges = new Map<string, SyncEntityChange>();
  const affectedBatchIds = new Set<string>();
  for (const requestedChange of [...operation.changes].sort(compareSyncEntityChanges)) {
    const canonicalChange = yield* applyChange(tx, actor, operation, requestedChange);
    canonicalChanges.set(syncEntityChangeKey(canonicalChange), canonicalChange);
    if (canonicalChange.entity === "batch") affectedBatchIds.add(canonicalChange.entityId);
    if (canonicalChange.entity === "stockMovement") {
      const row = yield* decodeEntityRow("stockMovement", canonicalChange);
      affectedBatchIds.add(row.batchId);
    }
  }

  for (const batchId of [...affectedBatchIds].sort()) {
    const replacement = yield* reconcileBatch(tx, actor, operation, batchId);
    canonicalChanges.set(syncEntityChangeKey(replacement), replacement);
  }

  let appliedCursor = 0;
  const orderedCanonicalChanges = [...canonicalChanges.values()].sort(compareSyncEntityChanges);
  for (const [ordinal, canonicalChange] of orderedCanonicalChanges.entries()) {
    const [logged] = yield* tx
      .insert(syncChangeLog)
      .values({
        organizationId: actor.organizationId,
        operationId: operation.operationId,
        ordinal,
        entity: canonicalChange.entity,
        action: canonicalChange.action,
        entityId: canonicalChange.entityId,
        rowVersion: canonicalChange.rowVersion,
        payload: canonicalChange,
        changedAt: Date.now(),
      })
      .returning({ cursor: syncChangeLog.cursor });
    if (!logged)
      return yield* Effect.fail(
        protocolError("CHANGE_LOG_FAILED", "A sync change could not be logged."),
      );
    appliedCursor = logged.cursor;
  }

  yield* tx
    .update(syncInbox)
    .set({ appliedCursor })
    .where(
      and(
        eq(syncInbox.organizationId, actor.organizationId),
        eq(syncInbox.operationId, operation.operationId),
      ),
    );
  return SyncAck.make({
    operationId: operation.operationId,
    status: "applied",
    cursor: appliedCursor,
  });
});
