import {
  CommandReceipt,
  incrementDecimalSequence,
  type EnqueueCommandRequest,
  type RegisterReplicaResult,
  type SyncCommandEnvelope,
} from "@store/contracts";
import type { CommandStatus, ReplicaReadStamp } from "@store/contracts/sync/replica-model";
import { commandOutbox, replicaState } from "@store/db/replica.schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { admitCommand } from "./admission";
import { decodeStoredEnvelope, encodeEnvelopeJson, encodeReceiptJson } from "./codecs";
import { stampOf } from "./commit-hub";
import {
  decideReceipt,
  isStaleClaim,
  RELEASED_CLAIM_FIELDS,
  settledOutboxFields,
} from "./decisions";
import { ReplicaStorageError } from "./errors";
import type { CommandContext } from "./footprint";
import { sqliteCatalogReads } from "./lookup";
import { projectLocalCommand, undoLocalEffects } from "./pending";
import type { PendingRestoreResult } from "./projection";
import {
  announcementFields,
  decideRegistration,
  UNRECEIPTED_COMMAND_STATUSES,
  type ReplicaRegistrationOutcome,
} from "./registration";
import type { ReplicaDb } from "./sql-client/drizzle";
import { sqlitePendingRows } from "./sqlite/pending-rows";

type CommandOutboxStatus = (typeof commandOutbox.$inferSelect)["status"];

type OutboxRow = typeof commandOutbox.$inferSelect;

export type ClaimNextUploadInput = {
  readonly claimId: string;
  readonly claimedAt: number;
  readonly staleBefore: number;
};

export type UploadClaim = {
  readonly operationId: string;
  readonly claimId: string;
  readonly claimedAt: number;
  readonly attempts: number;
  readonly outcomeUncertain: boolean;
  readonly envelope: SyncCommandEnvelope;
};

const INTEGRATED_COMMAND_RETENTION = 256;

export const clientSequenceLength = sql`length(${commandOutbox.clientSequence})`;

export const loadReplicaState = Effect.fn("ReplicaCommands.loadReplicaState")(function* (
  tx: ReplicaDb,
) {
  const state = yield* tx.select().from(replicaState).get();
  if (!state) {
    return yield* Effect.fail(ReplicaStorageError.make({ message: "Replica state is missing." }));
  }
  return state;
});

export const recordCaughtUp = Effect.fn("ReplicaCommands.recordCaughtUp")(function* (
  tx: ReplicaDb,
  caughtUpAt: number,
) {
  const state = yield* loadReplicaState(tx);
  yield* tx.update(replicaState).set({ caughtUpAt }).where(eq(replicaState.id, state.id));
  return state;
});

const bumpLocalCommitVersion = Effect.fn("ReplicaCommands.bumpLocalCommitVersion")(function* (
  tx: ReplicaDb,
) {
  const state = yield* loadReplicaState(tx);
  yield* tx
    .update(replicaState)
    .set({ localCommitVersion: state.localCommitVersion + 1 })
    .where(eq(replicaState.id, state.id));
});

const updateOutbox = (tx: ReplicaDb, operationId: string, fields: Partial<OutboxRow>) =>
  tx.update(commandOutbox).set(fields).where(eq(commandOutbox.operationId, operationId));

const selectOutboxRow = (tx: ReplicaDb, operationId: string) =>
  tx.select().from(commandOutbox).where(eq(commandOutbox.operationId, operationId)).get();

export const commandStatus = Effect.fn("ReplicaCommands.commandStatus")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  const row = yield* selectOutboxRow(tx, operationId);
  return row?.status;
});

type AdmittedCommand = {
  readonly envelope: SyncCommandEnvelope;
  readonly state: typeof replicaState.$inferSelect;
  readonly context: CommandContext;
};

type LocalAdmission =
  | { readonly _tag: "replayed"; readonly status: CommandStatus; readonly stamp: ReplicaReadStamp }
  | ({ readonly _tag: "admitted" } & AdmittedCommand);

export const admitLocalCommand = Effect.fn("ReplicaCommands.admitLocalCommand")(function* (
  tx: ReplicaDb,
  request: EnqueueCommandRequest,
) {
  const existing = yield* selectOutboxRow(tx, request.operationId);
  const state = yield* loadReplicaState(tx);
  const admission = yield* admitCommand(
    state,
    existing
      ? { status: existing.status, envelope: yield* decodeStoredEnvelope(existing) }
      : undefined,
    request,
    sqliteCatalogReads(tx, state.organizationId),
  );
  return admission._tag === "replayed"
    ? ({ ...admission, stamp: stampOf(state) } satisfies LocalAdmission)
    : ({ ...admission, state } satisfies LocalAdmission);
});

export const projectAdmittedCommand = (
  tx: ReplicaDb,
  { envelope, state, context }: AdmittedCommand,
) =>
  projectLocalCommand(
    sqlitePendingRows(tx, state.organizationId),
    envelope,
    { organizationId: state.organizationId, userId: state.userId },
    context,
  );

export const queueAdmittedCommand = Effect.fn("ReplicaCommands.queueAdmittedCommand")(function* (
  tx: ReplicaDb,
  { envelope, state }: AdmittedCommand,
  occurredAt: number,
) {
  yield* tx.insert(commandOutbox).values({
    operationId: envelope.operationId,
    status: "pending",
    envelopeJson: encodeEnvelopeJson(envelope),
    receiptJson: null,
    clientSequence: envelope.clientSequence,
    createdAt: occurredAt,
  });
  const localCommitVersion = state.localCommitVersion + 1;
  yield* tx
    .update(replicaState)
    .set({
      nextClientSequence: incrementDecimalSequence(state.nextClientSequence),
      localCommitVersion,
    })
    .where(eq(replicaState.id, state.id));
  return stampOf({ activeGeneration: state.activeGeneration, localCommitVersion });
});

export const pruneIntegratedCommands = Effect.fn("ReplicaCommands.pruneIntegratedCommands")(
  function* (tx: ReplicaDb, latestClientSequence: string) {
    const newestPruned = BigInt(latestClientSequence) - BigInt(INTEGRATED_COMMAND_RETENTION);
    if (newestPruned <= 0n) return;
    const threshold = String(newestPruned);
    yield* tx
      .delete(commandOutbox)
      .where(
        and(
          eq(commandOutbox.status, "integrated"),
          sql`(${clientSequenceLength}, ${commandOutbox.clientSequence}) <= (${threshold.length}, ${threshold})`,
        ),
      );
  },
);

export const claimNextUpload = Effect.fn("ReplicaCommands.claimNextUpload")(function* (
  tx: ReplicaDb,
  input: ClaimNextUploadInput,
) {
  const sending = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "sending"))
    .all();
  if (sending.some((claim) => !isStaleClaim(claim, input.staleBefore))) return undefined;
  for (const claim of sending) {
    yield* updateOutbox(tx, claim.operationId, RELEASED_CLAIM_FIELDS);
  }
  const row = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "pending"))
    .orderBy(clientSequenceLength, commandOutbox.clientSequence)
    .limit(1)
    .get();
  if (!row) return undefined;
  const envelope = yield* decodeStoredEnvelope(row);
  const attempts = row.attempts + 1;
  yield* updateOutbox(tx, row.operationId, {
    status: "sending",
    claimId: input.claimId,
    claimedAt: input.claimedAt,
    attempts,
  });
  yield* bumpLocalCommitVersion(tx);
  return {
    operationId: row.operationId,
    claimId: input.claimId,
    claimedAt: input.claimedAt,
    attempts,
    outcomeUncertain: row.outcomeUncertain,
    envelope,
  } satisfies UploadClaim;
});

type SettledCommand = {
  readonly status: CommandOutboxStatus;
  readonly restored: PendingRestoreResult | undefined;
};

const settleCommandReceipt = Effect.fn("ReplicaCommands.settleCommandReceipt")(function* (
  tx: ReplicaDb,
  receipt: CommandReceipt,
  claimId?: string,
) {
  const row = yield* selectOutboxRow(tx, receipt.operationId);
  if (!row) return undefined;
  const envelope = yield* decodeStoredEnvelope(row);
  const claimMatches =
    claimId === undefined || (row.status === "sending" && row.claimId === claimId);
  const decision = yield* Effect.fromResult(
    decideReceipt(row.status, envelope, receipt, claimMatches),
  );
  if (decision._tag === "noop") {
    return { status: decision.status, restored: undefined } satisfies SettledCommand;
  }
  const settled = settledOutboxFields(receipt, encodeReceiptJson(receipt));
  if (decision._tag === "refreshIntegrated") {
    yield* updateOutbox(tx, receipt.operationId, settled);
    return { status: decision.status, restored: undefined } satisfies SettledCommand;
  }
  const restored =
    decision._tag === "rejected"
      ? yield* undoLocalEffects(
          sqlitePendingRows(tx, (yield* loadReplicaState(tx)).organizationId),
          receipt.operationId,
        )
      : undefined;
  yield* updateOutbox(tx, receipt.operationId, { ...settled, status: decision.status });
  yield* bumpLocalCommitVersion(tx);
  return { status: decision.status, restored } satisfies SettledCommand;
});

export const recordCommandReceipt = (tx: ReplicaDb, receipt: CommandReceipt) =>
  settleCommandReceipt(tx, receipt);

export const settleUploadClaim = (tx: ReplicaDb, claimId: string, receipt: CommandReceipt) =>
  settleCommandReceipt(tx, receipt, claimId);

export const releaseUploadClaim = Effect.fn("ReplicaCommands.releaseUploadClaim")(function* (
  tx: ReplicaDb,
  operationId: string,
  claimId: string,
) {
  const row = yield* selectOutboxRow(tx, operationId);
  if (!row || row.status !== "sending" || row.claimId !== claimId) return row?.status;
  yield* updateOutbox(tx, operationId, RELEASED_CLAIM_FIELDS);
  yield* bumpLocalCommitVersion(tx);
  return RELEASED_CLAIM_FIELDS.status;
});

export const adoptReplicaRegistration = Effect.fn("ReplicaCommands.adoptReplicaRegistration")(
  function* (tx: ReplicaDb, authority: RegisterReplicaResult, registeredAt: number) {
    const state = yield* loadReplicaState(tx);
    const rows = yield* tx
      .select()
      .from(commandOutbox)
      .where(inArray(commandOutbox.status, [...UNRECEIPTED_COMMAND_STATUSES]))
      .all();
    const outbox = yield* Effect.forEach(rows, (row) =>
      decodeStoredEnvelope(row).pipe(Effect.map((envelope) => ({ ...row, envelope }))),
    );
    const decision = decideRegistration(state, outbox, authority);
    if (decision._tag === "refuse") {
      return {
        _tag: "refused",
        code: decision.code,
        message: decision.message,
      } satisfies ReplicaRegistrationOutcome;
    }
    if (decision._tag === "adopt") {
      for (const restamped of decision.restamp) {
        yield* updateOutbox(tx, restamped.operationId, {
          envelopeJson: encodeEnvelopeJson(restamped.envelope),
          clientSequence: restamped.envelope.clientSequence,
        });
      }
      yield* tx
        .update(replicaState)
        .set({
          epoch: decision.epoch,
          incarnation: decision.incarnation,
          nextClientSequence: decision.nextClientSequence,
          registeredAt,
          ...announcementFields(authority),
        })
        .where(eq(replicaState.id, state.id));
      return { _tag: "registered" } satisfies ReplicaRegistrationOutcome;
    }
    yield* tx
      .update(replicaState)
      .set(announcementFields(authority))
      .where(eq(replicaState.id, state.id));
    return { _tag: "registered" } satisfies ReplicaRegistrationOutcome;
  },
);
