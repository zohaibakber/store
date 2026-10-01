import {
  CommandReceipt,
  incrementDecimalSequence,
  SyncCommandEnvelope,
  syncProtocolError,
  type EnqueueCommandRequest,
  type RegisterReplicaResult,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import type { CommandStatus, ReplicaReadStamp } from "@store/contracts/sync/replica-model";
import { commandOutbox, replicaState, stockOverlays } from "@store/db/replica.schema";
import { eq, inArray, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeStoredEnvelope, encodeEnvelopeJson, encodeReceiptJson } from "./codecs";
import { stampOf, withStockTouched } from "./commit-hub";
import {
  checkAuthorityHead,
  checkIncarnation,
  decideEnqueueReplay,
  decideOverlays,
  decideReceipt,
  isStaleClaim,
  RELEASED_CLAIM_FIELDS,
  type StaleClaimCutoff,
  settledOutboxFields,
} from "./decisions";
import { ReplicaStorageError } from "./errors";
import { readCommandContext, readVisibleBatchStock } from "./lookup";
import { restorePendingProjection, writePendingProjection } from "./pending";
import {
  checkEnqueueAllowed,
  type CommandProjection,
  type PendingRestoreResult,
} from "./projection";
import {
  decideRegistration,
  UNRECEIPTED_COMMAND_STATUSES,
  type ReplicaRegistrationOutcome,
} from "./registration";
import type { ReplicaDb } from "./sql-client/drizzle";

type CommandOutboxStatus = (typeof commandOutbox.$inferSelect)["status"];

type OutboxRow = typeof commandOutbox.$inferSelect;

export type ClaimNextUploadInput = {
  readonly claimId: string;
  readonly claimedAt: number;
};

export type UploadClaim = {
  readonly operationId: string;
  readonly claimId: string;
  readonly claimedAt: number;
  readonly attempts: number;
  readonly outcomeUncertain: boolean;
  readonly envelope: SyncCommandEnvelope;
};

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

export const visibleBatchStock = Effect.fn("ReplicaCommands.visibleBatchStock")(function* (
  tx: ReplicaDb,
  batchId: string,
) {
  const { organizationId } = yield* loadReplicaState(tx);
  return yield* readVisibleBatchStock(tx, organizationId, batchId);
});

export const commandStatus = Effect.fn("ReplicaCommands.commandStatus")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  const row = yield* selectOutboxRow(tx, operationId);
  return row?.status;
});

export const parseStoredEnvelope = (row: OutboxRow) => decodeStoredEnvelope(row);

type SavedLocalCommand = {
  readonly status: CommandStatus;
  readonly stamp: ReplicaReadStamp;
  readonly changed: boolean;
  readonly projection: CommandProjection | undefined;
  readonly stockBatchIds: ReadonlyArray<string>;
};

const decodeEnvelope = Schema.decodeUnknownEffect(SyncCommandEnvelope);

export const saveLocalCommand = Effect.fn("ReplicaCommands.saveLocalCommand")(function* (
  tx: ReplicaDb,
  request: EnqueueCommandRequest,
) {
  const existing = yield* selectOutboxRow(tx, request.operationId);
  const state = yield* loadReplicaState(tx);
  const payloadHash = canonicalPayloadHash(request.command);
  const replay = yield* Effect.fromResult(
    decideEnqueueReplay(
      existing
        ? { status: existing.status, envelope: yield* parseStoredEnvelope(existing) }
        : undefined,
      payloadHash,
    ),
  );
  if (replay !== undefined) {
    return {
      status: replay,
      stamp: stampOf(state),
      changed: false,
      projection: undefined,
      stockBatchIds: [],
    } satisfies SavedLocalCommand;
  }
  const envelope = yield* decodeEnvelope({
    organizationId: state.organizationId,
    epoch: state.epoch,
    replicaId: state.replicaId,
    clientSequence: state.nextClientSequence,
    operationId: request.operationId,
    payloadHash,
    command: request.command,
  }).pipe(Effect.mapError((error) => syncProtocolError("INVALID_OPERATION", error.message)));
  const context = yield* readCommandContext(tx, state.organizationId, envelope.command, {
    checkRules: true,
    withStock: true,
  });
  yield* checkEnqueueAllowed(envelope, context.lookup, context.unitsPerPackFor, context.stockFor);
  const overlays = decideOverlays(envelope, context.unitsPerPackFor);
  for (const overlay of overlays) {
    yield* tx.insert(stockOverlays).values(overlay);
  }
  const projection = yield* writePendingProjection(
    tx,
    envelope,
    { organizationId: state.organizationId, userId: state.userId },
    context.lookup,
  );
  yield* tx.insert(commandOutbox).values({
    operationId: envelope.operationId,
    status: "pending",
    envelopeJson: encodeEnvelopeJson(envelope),
    receiptJson: null,
    clientSequence: envelope.clientSequence,
    createdAt: request.occurredAt,
  });
  const localCommitVersion = state.localCommitVersion + 1;
  yield* tx
    .update(replicaState)
    .set({
      nextClientSequence: incrementDecimalSequence(state.nextClientSequence),
      localCommitVersion,
    })
    .where(eq(replicaState.id, state.id));
  return {
    status: "pending",
    stamp: stampOf({ activeGeneration: state.activeGeneration, localCommitVersion }),
    changed: true,
    projection,
    stockBatchIds: [...new Set(overlays.map((overlay) => overlay.batchId))],
  } satisfies SavedLocalCommand;
});

const undoLocalEffects = Effect.fn("ReplicaCommands.undoLocalEffects")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  const overlays = yield* tx
    .select({ batchId: stockOverlays.batchId })
    .from(stockOverlays)
    .where(eq(stockOverlays.commandId, operationId))
    .all();
  yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, operationId));
  const restored = yield* restorePendingProjection(tx, operationId);
  return withStockTouched(
    restored,
    overlays.map((overlay) => overlay.batchId),
  );
});

export const claimNextUpload = Effect.fn("ReplicaCommands.claimNextUpload")(function* (
  tx: ReplicaDb,
  input: ClaimNextUploadInput,
) {
  const outstanding = yield* tx
    .select({ operationId: commandOutbox.operationId })
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "sending"))
    .get();
  if (outstanding) return undefined;
  const row = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "pending"))
    .orderBy(sql`length(${commandOutbox.clientSequence})`, commandOutbox.clientSequence)
    .limit(1)
    .get();
  if (!row) return undefined;
  const envelope = yield* parseStoredEnvelope(row);
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
  const envelope = yield* parseStoredEnvelope(row);
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
    decision._tag === "rejected" ? yield* undoLocalEffects(tx, receipt.operationId) : undefined;
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

export const verifyReplicaIncarnation = Effect.fn("ReplicaCommands.verifyReplicaIncarnation")(
  function* (tx: ReplicaDb, incarnation: string) {
    const state = yield* loadReplicaState(tx);
    yield* Effect.fromResult(checkIncarnation(state.incarnation, incarnation));
  },
);

export const verifyAuthorityHeadNotBehind = Effect.fn(
  "ReplicaCommands.verifyAuthorityHeadNotBehind",
)(function* (tx: ReplicaDb, authorityHorizon: string) {
  const state = yield* loadReplicaState(tx);
  yield* Effect.fromResult(checkAuthorityHead(state.appliedCommitSequence, authorityHorizon));
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
      parseStoredEnvelope(row).pipe(Effect.map((envelope) => ({ ...row, envelope }))),
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
        })
        .where(eq(replicaState.id, state.id));
    }
    return { _tag: "registered" } satisfies ReplicaRegistrationOutcome;
  },
);

export const recoverStaleUploadClaims = Effect.fn("ReplicaCommands.recoverStaleUploadClaims")(
  function* (tx: ReplicaDb, staleBefore: StaleClaimCutoff) {
    const sending = yield* tx
      .select()
      .from(commandOutbox)
      .where(eq(commandOutbox.status, "sending"))
      .all();
    const stale = sending.filter((row) => isStaleClaim(row, staleBefore));
    for (const row of stale) {
      yield* updateOutbox(tx, row.operationId, RELEASED_CLAIM_FIELDS);
    }
    if (stale.length > 0) yield* bumpLocalCommitVersion(tx);
    return stale.length;
  },
);
