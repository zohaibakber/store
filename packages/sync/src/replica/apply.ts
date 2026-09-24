import {
  compareDecimalSequence,
  type SyncLiveServerFrame,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { commandOutbox, replicaState, stockOverlays } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { decodeCategoryRow, decodeInvoiceRow } from "./codecs";
import { loadReplicaState } from "./commands";
import { updateCoverageFromPull } from "./coverage";
import { shouldApplyCommitSequence } from "./decisions";
import {
  clearPendingProjection,
  renameCollidingShadowCategory,
  renumberCollidingShadowInvoice,
  resolveRemoteRow,
  restorePendingProjection,
} from "./pending";
import { removeEntityRow, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";

type PullApplyResult = {
  readonly appliedThrough: string;
  readonly repairRequired: boolean;
  readonly digestVerified: boolean;
  readonly touchedKeys: ReadonlyArray<string>;
};

type GroupApplyResult = {
  readonly appliedThrough: string;
  readonly touchedKeys: ReadonlyArray<string>;
};

export type ReplicaFeedMode =
  | {
      readonly _tag: "catchingUp";
      readonly targetCommitSequence: string;
    }
  | {
      readonly _tag: "following";
    };

export const feedAfterPull = (pulled: SyncPullResult, appliedThrough: string): ReplicaFeedMode => {
  if (compareDecimalSequence(appliedThrough, pulled.horizon) >= 0) {
    return { _tag: "following" };
  }
  return {
    _tag: "catchingUp",
    targetCommitSequence: pulled.horizon,
  };
};

const applyChange = Effect.fn("ReplicaApply.applyChange")(function* (
  tx: ReplicaDb,
  change: SyncTransactionGroup["changes"][number],
  operationId: string,
) {
  if (change.action === "delete") {
    yield* removeEntityRow(tx, change.entity, change.entityId);
    return undefined;
  }
  const renamed =
    change.entity === "invoice"
      ? yield* renumberCollidingShadowInvoice(tx, decodeInvoiceRow(change.row), operationId)
      : change.entity === "category"
        ? yield* renameCollidingShadowCategory(tx, decodeCategoryRow(change.row), operationId)
        : undefined;
  yield* writeEntityRow(tx, change.entity, change.row);
  return renamed;
});

export const applyTransactionGroup = Effect.fn("ReplicaApply.applyTransactionGroup")(function* (
  tx: ReplicaDb,
  group: SyncTransactionGroup,
) {
  const state = yield* loadReplicaState(tx);
  if (!shouldApplyCommitSequence(state.appliedCommitSequence, group.commitSequence)) {
    return {
      appliedThrough: state.appliedCommitSequence,
      touchedKeys: [],
    } satisfies GroupApplyResult;
  }
  const touchedKeys: Array<string> = [];
  for (const change of group.changes) {
    const renumbered = yield* applyChange(tx, change, group.operationId);
    if (renumbered) touchedKeys.push(renumbered);
    yield* resolveRemoteRow(tx, change.entity, change.entityId);
  }
  if (group.decision === "rejected") {
    yield* restorePendingProjection(tx, group.operationId);
  } else {
    yield* clearPendingProjection(tx, group.operationId);
  }
  yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, group.operationId));
  const outbox = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, group.operationId))
    .get();
  if (outbox && outbox.status !== "rejected") {
    yield* tx
      .update(commandOutbox)
      .set({ status: "integrated" })
      .where(eq(commandOutbox.operationId, group.operationId));
  }
  yield* tx
    .update(replicaState)
    .set({
      appliedCommitSequence: group.commitSequence,
      localCommitVersion: state.localCommitVersion + 1,
    })
    .where(eq(replicaState.id, state.id));
  return { appliedThrough: group.commitSequence, touchedKeys } satisfies GroupApplyResult;
});

export const applyPullResult = Effect.fn("ReplicaApply.applyPullResult")(function* (
  tx: ReplicaDb,
  pulled: SyncPullResult,
) {
  const state = yield* loadReplicaState(tx);
  let appliedThrough = state.appliedCommitSequence;
  const touchedKeys: Array<string> = [];
  for (const group of pulled.transactions) {
    const applied = yield* applyTransactionGroup(tx, group);
    appliedThrough = applied.appliedThrough;
    touchedKeys.push(...applied.touchedKeys);
  }
  const coverage = yield* updateCoverageFromPull(tx, pulled, appliedThrough);
  return {
    appliedThrough,
    repairRequired: coverage.repairRequired,
    digestVerified: coverage.digestVerified,
    touchedKeys,
  } satisfies PullApplyResult;
});

export const applyLiveFrame = Effect.fn("ReplicaApply.applyLiveFrame")(function* (
  tx: ReplicaDb,
  feed: ReplicaFeedMode,
  frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
) {
  if (feed._tag !== "following") return false;
  for (const group of frame.transactions) {
    yield* applyTransactionGroup(tx, group);
  }
  return true;
});
