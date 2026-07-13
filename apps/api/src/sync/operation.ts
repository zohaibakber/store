import { compareCodeUnits, SyncAck, SyncEntityChange, type SyncOperation } from "@store/contracts";
import { syncChangeLog, syncInbox } from "@store/db/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { applyChange } from "./apply-change";
import type { SyncTransaction } from "./database.client";
import { protocolError } from "./errors";
import { reconcileBatch } from "./inventory";
import type { SyncActor } from "./model";
import { rowOf, stringValue } from "./row-validation";

const dependencyOrder = {
  category: 0,
  product: 1,
  batch: 2,
  invoice: 2,
  invoiceItem: 3,
  stockMovement: 4,
} as const;

const compareChanges = (left: SyncEntityChange, right: SyncEntityChange) =>
  dependencyOrder[left.entity] - dependencyOrder[right.entity] ||
  compareCodeUnits(left.entityId, right.entityId);

const changeKey = (change: SyncEntityChange) => `${change.entity}\u0000${change.entityId}`;

export const applyOperation = Effect.fn("SyncDatabase.applyOperation")(function* (
  tx: SyncTransaction,
  actor: SyncActor,
  operation: SyncOperation,
) {
  // Serialize a device's operation sequence so sequence reuse cannot race the
  // unique constraint and surface as an untyped infrastructure failure.
  yield* tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      actor.organizationId,
      operation.deviceId,
    ])}, 0))`,
  );
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
      .limit(1)
      .for("update");
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

  const canonicalChanges = new Map<string, SyncEntityChange>();
  const affectedBatchIds = new Set<string>();
  for (const requestedChange of [...operation.changes].sort(compareChanges)) {
    const canonicalChange = yield* applyChange(tx, actor, operation, requestedChange);
    canonicalChanges.set(changeKey(canonicalChange), canonicalChange);
    if (canonicalChange.entity === "batch") affectedBatchIds.add(canonicalChange.entityId);
    if (canonicalChange.entity === "stockMovement") {
      const row = yield* rowOf(canonicalChange);
      affectedBatchIds.add(yield* stringValue(row, "batchId"));
    }
  }

  for (const batchId of [...affectedBatchIds].sort()) {
    const replacement = yield* reconcileBatch(tx, actor, operation, batchId);
    canonicalChanges.set(changeKey(replacement), replacement);
  }

  let appliedCursor = 0;
  const orderedCanonicalChanges = [...canonicalChanges.values()].sort(compareChanges);
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
