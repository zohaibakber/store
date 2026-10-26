import {
  AuthorityIncarnation,
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  OperationId,
  OrgCommitSequence,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  syncProtocolError,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { commandOutbox } from "@store/db/replica.schema";
import { and, desc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeStoredEnvelope } from "../replica/codecs";
import { clientSequenceLength, loadReplicaState } from "../replica/commands";
import type { ReplicaDb } from "../replica/sql-client/drizzle";
import { decideCommand, groupOf } from "./command";

export const LOCAL_AUTHORITY_EPOCH = SyncEpoch.make("1");

export type ReplicaStateRow = Effect.Success<ReturnType<typeof loadReplicaState>>;

const DECIDED_STATUSES = ["integrated", "accepted_awaiting_integration", "rejected"] as const;

const UNAPPLIED_STATUSES = ["accepted_awaiting_integration", "rejected"] as const;

export const nextCommitSequence = (state: ReplicaStateRow) =>
  OrgCommitSequence.make(incrementDecimalSequence(state.appliedCommitSequence));

export const decidedTail = Effect.fn("LocalAuthority.decidedTail")(function* (
  tx: ReplicaDb,
  state: ReplicaStateRow,
) {
  const latest = yield* Effect.forEach(DECIDED_STATUSES, (status) =>
    tx
      .select({ clientSequence: commandOutbox.clientSequence })
      .from(commandOutbox)
      .where(eq(commandOutbox.status, status))
      .orderBy(desc(clientSequenceLength), desc(commandOutbox.clientSequence))
      .limit(1)
      .get(),
  );
  const unapplied = yield* Effect.forEach(UNAPPLIED_STATUSES, (status) =>
    tx
      .select()
      .from(commandOutbox)
      .where(
        and(
          eq(commandOutbox.status, status),
          eq(commandOutbox.commitSequence, nextCommitSequence(state)),
        ),
      )
      .limit(1)
      .get(),
  );
  return {
    lastClientSequence: latest.reduce(
      (last, row) =>
        row !== undefined && compareDecimalSequence(row.clientSequence, last) > 0
          ? row.clientSequence
          : last,
      "0",
    ),
    unapplied: unapplied.find((row) => row !== undefined),
  };
});

const ReceiptJson = Schema.fromJsonString(CommandReceipt);

const decodeReceiptJson = Schema.decodeUnknownEffect(ReceiptJson);

const decodeIncarnation = Schema.decodeUnknownEffect(AuthorityIncarnation);

export const storedReceipt = Effect.fn("LocalAuthority.storedReceipt")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  const row = yield* tx
    .select({ receiptJson: commandOutbox.receiptJson })
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, operationId))
    .get();
  return row === undefined || row.receiptJson === null
    ? undefined
    : yield* decodeReceiptJson(row.receiptJson);
});

export const incarnationOf = (state: ReplicaStateRow) =>
  decodeIncarnation(state.registeredAt === null ? `local-${state.replicaId}` : state.incarnation);

const decodeEpoch = Schema.decodeUnknownEffect(SyncEpoch);

export const epochOf = (state: ReplicaStateRow) =>
  decodeEpoch(state.registeredAt === null ? LOCAL_AUTHORITY_EPOCH : state.epoch);

export const pageOf = Effect.fn("LocalAuthority.pageOf")(function* (
  state: ReplicaStateRow,
  afterCommitSequence: OrgCommitSequence,
  transactions: ReadonlyArray<SyncTransactionGroup>,
) {
  const applied = state.appliedCommitSequence;
  const last = transactions.at(-1)?.commitSequence;
  return {
    epoch: yield* epochOf(state),
    incarnation: yield* incarnationOf(state),
    subscription: OPERATIONAL_SUBSCRIPTION,
    schemaVersion: SYNC_SCHEMA_VERSION,
    transactions,
    nextCommitSequence: last ?? afterCommitSequence,
    horizon: last ?? applied,
    retentionFloor: applied,
  } satisfies SyncPullResult;
});

const unappliedGroup = Effect.fn("LocalAuthority.unappliedGroup")(function* (
  tx: ReplicaDb,
  state: ReplicaStateRow,
  row: typeof commandOutbox.$inferSelect,
) {
  const commitSequence = nextCommitSequence(state);
  const unreproducible = syncProtocolError(
    "ENTITY_WRITE_FAILED",
    "A recorded decision can no longer be reproduced from the local replica.",
  );
  if (row.status === "rejected") {
    return {
      commitSequence,
      operationId: OperationId.make(row.operationId),
      decision: "rejected",
      changes: [],
    } satisfies SyncTransactionGroup;
  }
  const envelope = yield* decodeStoredEnvelope(row);
  const { group } = groupOf(
    commitSequence,
    envelope.operationId,
    yield* decideCommand(tx, state, envelope),
  );
  return group.decision === "accepted" ? group : yield* unreproducible;
});

export const pageAfter = Effect.fn("LocalAuthority.pageAfter")(function* (
  tx: ReplicaDb,
  state: ReplicaStateRow,
  afterCommitSequence: OrgCommitSequence,
) {
  if (afterCommitSequence !== state.appliedCommitSequence) return undefined;
  const { unapplied } = yield* decidedTail(tx, state);
  return yield* pageOf(
    state,
    afterCommitSequence,
    unapplied === undefined ? [] : [yield* unappliedGroup(tx, state, unapplied)],
  );
});
