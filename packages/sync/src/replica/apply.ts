import { compareDecimalSequence, type SyncTransactionGroup } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { batches, commandOutbox, replicaState, stockOverlays } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite } from "../sqlite";
import { loadReplicaState } from "./commands";
import type { ReplicaDb } from "./storage";

const isBatchRow = Schema.is(syncEntityRows.batch.schema);

type AppliedBatchRow = (typeof syncEntityRows.batch.schema)["Type"];

const upsertBatch = (tx: ReplicaDb, row: AppliedBatchRow) => {
  const existing = tx.select().from(batches).where(eq(batches.id, row.id)).get();
  if (existing) {
    runWrite(
      tx
        .update(batches)
        .set({
          packQuantity: row.packQuantity,
          unitQuantity: row.unitQuantity,
          batchNumber: row.batchNumber,
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
          updatedByUserId: row.updatedByUserId,
          deviceId: row.deviceId,
          operationId: row.operationId,
          rowVersion: row.rowVersion,
          deletedAt: row.deletedAt,
        })
        .where(eq(batches.id, row.id)),
    );
    return;
  }
  runWrite(tx.insert(batches).values(row));
};

export const applyTransactionGroup = (tx: ReplicaDb, group: SyncTransactionGroup) => {
  const state = loadReplicaState(tx);
  if (compareDecimalSequence(group.commitSequence, state.appliedCommitSequence) <= 0) {
    return state.appliedCommitSequence;
  }
  for (const change of group.changes) {
    if (change.entity === "batch" && change.action === "upsert" && isBatchRow(change.row)) {
      upsertBatch(tx, change.row);
    }
  }
  runWrite(tx.delete(stockOverlays).where(eq(stockOverlays.commandId, group.operationId)));
  const outbox = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, group.operationId))
    .get();
  if (outbox && outbox.status !== "rejected") {
    runWrite(
      tx
        .update(commandOutbox)
        .set({ status: "integrated" })
        .where(eq(commandOutbox.operationId, group.operationId)),
    );
  }
  runWrite(
    tx
      .update(replicaState)
      .set({
        appliedCommitSequence: group.commitSequence,
        localCommitVersion: state.localCommitVersion + 1,
      })
      .where(eq(replicaState.id, state.id)),
  );
  return group.commitSequence;
};
