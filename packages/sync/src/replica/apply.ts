import {
  compareDecimalSequence,
  type SyncLiveServerFrame,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { batches, commandOutbox, replicaState, stockOverlays } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite } from "../sqlite";
import { loadReplicaState } from "./commands";
import { updateCoverageFromPull } from "./coverage";
import type { ReplicaDb } from "./storage";

export type PullApplyResult = {
  readonly appliedThrough: string;
  readonly repairRequired: boolean;
};

const isBatchRow = Schema.is(syncEntityRows.batch.schema);

type AppliedBatchRow = (typeof syncEntityRows.batch.schema)["Type"];

export type ReplicaFeedMode =
  | {
      readonly _tag: "catchingUp";
      readonly targetCommitSequence: string;
    }
  | {
      readonly _tag: "following";
    };

export const isFollowingFeed = (feed: ReplicaFeedMode): boolean => feed._tag === "following";

export const feedAfterPull = (
  feed: ReplicaFeedMode,
  pulled: SyncPullResult,
  appliedThrough: string,
): ReplicaFeedMode => {
  if (compareDecimalSequence(appliedThrough, pulled.horizon) >= 0) {
    return { _tag: "following" };
  }
  return {
    _tag: "catchingUp",
    targetCommitSequence: pulled.horizon,
  };
};

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

export const applyPullResult = (tx: ReplicaDb, pulled: SyncPullResult): PullApplyResult => {
  let appliedThrough = loadReplicaState(tx).appliedCommitSequence;
  for (const group of pulled.transactions) {
    appliedThrough = applyTransactionGroup(tx, group);
  }
  const coverage = updateCoverageFromPull(tx, pulled, appliedThrough);
  return { appliedThrough, repairRequired: coverage.repairRequired };
};

export const applyLiveFrame = (
  tx: ReplicaDb,
  feed: ReplicaFeedMode,
  frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
): boolean => {
  if (!isFollowingFeed(feed)) return false;
  for (const group of frame.transactions) {
    applyTransactionGroup(tx, group);
  }
  return true;
};
