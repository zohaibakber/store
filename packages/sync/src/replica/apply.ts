import {
  compareDecimalSequence,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { commandOutbox, replicaState } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { loadReplicaState } from "./commands";
import { EMPTY_TOUCHED, mergeTouched, touchedOfChange, type TouchedSet } from "./commit-hub";
import { readDigestFence, type DigestFence } from "./coverage";
import { shouldApplyCommitSequence } from "./decisions";
import { integrateGroupOverPending } from "./pending";
import { removeEntityRow, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";
import { encodeGroupJson, recordActiveMutation } from "./sqlite/generation";
import { hasPendingProjection, sqlitePendingRows } from "./sqlite/pending-rows";

type PullApplyResult = TouchedSet & {
  readonly appliedThrough: string;
  readonly digestFence: DigestFence | undefined;
};

type GroupApplyResult = TouchedSet & {
  readonly appliedThrough: string;
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

const applySettledRows = Effect.fn("ReplicaApply.applySettledRows")(function* (
  tx: ReplicaDb,
  organizationId: string,
  group: SyncTransactionGroup,
) {
  for (const change of group.changes) {
    switch (change.action) {
      case "delete":
        yield* removeEntityRow(tx, organizationId, change.entity, change.entityId);
        break;
      case "upsert":
        yield* writeEntityRow(tx, change.entity, change.row);
        break;
    }
  }
  return mergeTouched(
    ...group.changes.map((change) => touchedOfChange(change.entity, change.entityId)),
  );
});

export const applyGroupRows = Effect.fn("ReplicaApply.applyGroupRows")(function* (
  tx: ReplicaDb,
  organizationId: string,
  group: SyncTransactionGroup,
) {
  return (yield* hasPendingProjection(tx))
    ? yield* integrateGroupOverPending(sqlitePendingRows(tx, organizationId), group)
    : yield* applySettledRows(tx, organizationId, group);
});

export const applyTransactionGroup = Effect.fn("ReplicaApply.applyTransactionGroup")(function* (
  tx: ReplicaDb,
  group: SyncTransactionGroup,
) {
  const state = yield* loadReplicaState(tx);
  if (!shouldApplyCommitSequence(state.appliedCommitSequence, group.commitSequence)) {
    return {
      appliedThrough: state.appliedCommitSequence,
      ...EMPTY_TOUCHED,
    } satisfies GroupApplyResult;
  }
  const touched = yield* applyGroupRows(tx, state.organizationId, group);
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
  yield* recordActiveMutation(tx, () => ({
    kind: "group",
    operationId: group.operationId,
    commitSequence: group.commitSequence,
    payloadJson: encodeGroupJson(group),
  }));
  return {
    appliedThrough: group.commitSequence,
    ...touched,
  } satisfies GroupApplyResult;
});

export const applyPullResult = Effect.fn("ReplicaApply.applyPullResult")(function* (
  tx: ReplicaDb,
  pulled: SyncPullResult,
) {
  const state = yield* loadReplicaState(tx);
  let appliedThrough = state.appliedCommitSequence;
  const touched: Array<TouchedSet> = [];
  for (const group of pulled.transactions) {
    const applied = yield* applyTransactionGroup(tx, group);
    appliedThrough = applied.appliedThrough;
    touched.push(applied);
  }
  return {
    appliedThrough,
    digestFence: pulled.digest === undefined ? undefined : yield* readDigestFence(tx),
    ...mergeTouched(...touched),
  } satisfies PullApplyResult;
});
