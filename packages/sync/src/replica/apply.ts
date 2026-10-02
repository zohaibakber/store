import {
  compareDecimalSequence,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { commandOutbox, replicaState, stockOverlays } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { decodeNamedRow, decodeNumberedRow } from "./codecs";
import { loadReplicaState } from "./commands";
import {
  EMPTY_TOUCHED,
  mergeTouched,
  touchedOfChange,
  touchedOfKey,
  withStockTouched,
  type TouchedSet,
} from "./commit-hub";
import { readDigestFence, type DigestFence } from "./coverage";
import { shouldApplyCommitSequence } from "./decisions";
import {
  hasPendingProjection,
  renameCollidingShadow,
  renumberCollidingShadow,
  resolveRemoteRow,
  restorePendingProjection,
} from "./pending";
import { removeEntityRow, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";
import { encodeGroupJson, recordActiveMutation } from "./sqlite/generation";

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

const displaceCollidingShadow = (
  tx: ReplicaDb,
  organizationId: string,
  change: SyncTransactionGroup["changes"][number],
  operationId: string,
) => {
  switch (change.entity) {
    case "invoice":
    case "purchaseOrder":
      return renumberCollidingShadow(
        tx,
        organizationId,
        change.entity,
        decodeNumberedRow(change.entity, change.row),
        operationId,
      );
    case "category":
    case "supplier":
      return renameCollidingShadow(
        tx,
        organizationId,
        change.entity,
        decodeNamedRow(change.entity, change.row),
        operationId,
      );
    case "product":
    case "batch":
    case "invoiceItem":
    case "stockMovement":
    case "purchaseOrderItem":
      return Effect.succeed(undefined);
  }
};

const applyChange = Effect.fn("ReplicaApply.applyChange")(function* (
  tx: ReplicaDb,
  organizationId: string,
  change: SyncTransactionGroup["changes"][number],
  operationId: string,
) {
  if (change.action === "delete") {
    yield* removeEntityRow(tx, organizationId, change.entity, change.entityId);
    return undefined;
  }
  const displaced = yield* displaceCollidingShadow(tx, organizationId, change, operationId);
  yield* writeEntityRow(tx, change.entity, change.row);
  return displaced;
});

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
  if (!(yield* hasPendingProjection(tx))) {
    return yield* applySettledRows(tx, organizationId, group);
  }
  const touched: Array<TouchedSet> = [];
  for (const change of group.changes) {
    const renumbered = yield* applyChange(tx, organizationId, change, group.operationId);
    touched.push(touchedOfChange(change.entity, change.entityId));
    if (renumbered) touched.push(touchedOfKey(renumbered));
    yield* resolveRemoteRow(tx, change.entity, change.entityId);
  }
  touched.push(yield* restorePendingProjection(tx, group.operationId));
  const overlays = yield* tx
    .select({ batchId: stockOverlays.batchId })
    .from(stockOverlays)
    .where(eq(stockOverlays.commandId, group.operationId))
    .all();
  yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, group.operationId));
  return withStockTouched(
    mergeTouched(...touched),
    overlays.map((overlay) => overlay.batchId),
  );
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
