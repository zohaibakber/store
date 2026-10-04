import { type SyncTransactionGroup } from "@store/contracts";
import { commandOutbox, replicaState } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import {
  admitAuthority,
  APPLIED,
  outcomeOfUnapplied,
  type Admission,
  type AuthorityPayload,
  type IntegrationOutcome,
} from "./admission-authority";
import { loadReplicaState } from "./commands";
import { EMPTY_TOUCHED, mergeTouched, touchedOfChange, type TouchedSet } from "./commit-hub";
import { readDigestFence, type DigestFence } from "./coverage";
import { integrateGroupOverPending } from "./pending";
import { removeEntityRow, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";
import { encodeGroupJson, recordActiveMutation } from "./sqlite/generation";
import { hasPendingProjection, sqlitePendingRows } from "./sqlite/pending-rows";
import type { IntegrateAuthorityInput } from "./store";

type AuthorityApplyResult = TouchedSet & {
  readonly outcome: IntegrationOutcome;
  readonly appliedThrough: string;
  readonly digestFence: DigestFence | undefined;
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

export const admitAuthorityWithin = Effect.fn("ReplicaApply.admitAuthorityWithin")(function* (
  tx: ReplicaDb,
  payload: AuthorityPayload,
) {
  return admitAuthority(yield* loadReplicaState(tx), payload);
});

const integrateGroup = Effect.fn("ReplicaApply.integrateGroup")(function* (
  tx: ReplicaDb,
  organizationId: string,
  group: SyncTransactionGroup,
) {
  const touched = yield* applyGroupRows(tx, organizationId, group);
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
  yield* recordActiveMutation(tx, () => ({
    kind: "group",
    operationId: group.operationId,
    commitSequence: group.commitSequence,
    payloadJson: encodeGroupJson(group),
  }));
  return touched;
});

export const applyAdmission = Effect.fn("ReplicaApply.applyAdmission")(function* (
  tx: ReplicaDb,
  payload: IntegrateAuthorityInput["payload"],
  admission: Admission,
) {
  const state = yield* loadReplicaState(tx);
  if (admission._tag === "pull" || admission._tag === "refuse") {
    return {
      outcome: outcomeOfUnapplied(admission),
      appliedThrough: state.appliedCommitSequence,
      digestFence: undefined,
      ...EMPTY_TOUCHED,
    } satisfies AuthorityApplyResult;
  }
  const touched: Array<TouchedSet> = [];
  if (admission._tag === "apply") {
    for (const group of admission.groups) {
      touched.push(yield* integrateGroup(tx, state.organizationId, group));
    }
    yield* tx
      .update(replicaState)
      .set({
        appliedCommitSequence: admission.through,
        localCommitVersion: state.localCommitVersion + 1,
      })
      .where(eq(replicaState.id, state.id));
  }
  return {
    outcome: admission._tag === "apply" ? APPLIED : outcomeOfUnapplied(admission),
    appliedThrough: admission._tag === "apply" ? admission.through : state.appliedCommitSequence,
    digestFence:
      payload._tag === "liveFrame" || payload.page.digest === undefined
        ? undefined
        : yield* readDigestFence(tx),
    ...mergeTouched(...touched),
  } satisfies AuthorityApplyResult;
});
