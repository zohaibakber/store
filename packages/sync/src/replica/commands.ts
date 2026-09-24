import {
  CommandReceipt,
  SyncCommandEnvelope,
  syncProtocolError,
  type RegisterReplicaResult,
} from "@store/contracts";
import {
  batches,
  commandOutbox,
  products,
  replicaState,
  stockOverlays,
} from "@store/db/replica.schema";
import { eq, inArray } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";

import { decodeStoredEnvelope, encodeEnvelopeJson, encodeReceiptJson } from "./codecs";
import {
  byClientSequence,
  checkAuthorityHead,
  checkIncarnation,
  decideEnqueue,
  decideReceipt,
  EMPTY_STOCK,
  isStaleClaim,
  nextUploadClaim,
  OUTSTANDING_COMMAND_STATUSES,
  RELEASED_CLAIM_FIELDS,
  settledOutboxFields,
  withOverlays,
} from "./decisions";
import { ReplicaStorageError } from "./errors";
import { replicaCatalogLookup, restorePendingProjection, writePendingProjection } from "./pending";
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

export type CommandOutboxStatus = (typeof commandOutbox.$inferSelect)["status"];

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

export const loadStockIndex = Effect.fn("ReplicaCommands.loadStockIndex")(function* (
  tx: ReplicaDb,
) {
  const productRows = yield* tx.select().from(products).all();
  const batchRows = yield* tx.select().from(batches).all();
  const overlayRows = yield* tx.select().from(stockOverlays).all();
  const unitsPerPack = new Map(productRows.map((row) => [row.id, row.unitsPerPack]));
  const overlaysByBatch = Array.groupBy(overlayRows, (overlay) => overlay.batchId);
  const stock = new Map(
    batchRows.map((batch) => [batch.id, withOverlays(batch, overlaysByBatch[batch.id] ?? [])]),
  );
  return {
    unitsPerPackFor: (productId: string) => unitsPerPack.get(productId) ?? 1,
    stockFor: (batchId: string) => stock.get(batchId) ?? EMPTY_STOCK,
  };
});

export const visibleBatchStock = Effect.fn("ReplicaCommands.visibleBatchStock")(function* (
  tx: ReplicaDb,
  batchId: string,
) {
  const batch = yield* tx.select().from(batches).where(eq(batches.id, batchId)).get();
  if (!batch) return undefined;
  const overlays = yield* tx
    .select()
    .from(stockOverlays)
    .where(eq(stockOverlays.batchId, batchId))
    .all();
  return withOverlays(batch, overlays);
});

export const commandStatus = Effect.fn("ReplicaCommands.commandStatus")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  const row = yield* selectOutboxRow(tx, operationId);
  return row?.status;
});

export const parseStoredEnvelope = (row: OutboxRow) => decodeStoredEnvelope(row);

export type SavedLocalCommand = {
  readonly status: CommandOutboxStatus;
  readonly projection: CommandProjection | undefined;
};

export const saveLocalCommand = Effect.fn("ReplicaCommands.saveLocalCommand")(function* (
  tx: ReplicaDb,
  envelope: SyncCommandEnvelope,
  createdAt: number,
) {
  const existing = yield* selectOutboxRow(tx, envelope.operationId);
  const state = yield* loadReplicaState(tx);
  const index = yield* loadStockIndex(tx);
  const existingEntry = existing
    ? { status: existing.status, envelope: yield* parseStoredEnvelope(existing) }
    : undefined;
  const decision = yield* Effect.fromResult(
    decideEnqueue(state, existingEntry, envelope, index.unitsPerPackFor, index.stockFor),
  );
  if (decision._tag === "replay") {
    return { status: decision.status, projection: undefined } satisfies SavedLocalCommand;
  }
  const lookup = yield* replicaCatalogLookup(tx);
  yield* checkEnqueueAllowed(envelope, lookup, index.unitsPerPackFor, index.stockFor);
  for (const overlay of decision.overlays) {
    yield* tx.insert(stockOverlays).values(overlay);
  }
  const projection = yield* writePendingProjection(tx, envelope);
  yield* tx.insert(commandOutbox).values({
    operationId: envelope.operationId,
    status: "pending",
    envelopeJson: encodeEnvelopeJson(envelope),
    receiptJson: null,
    clientSequence: envelope.clientSequence,
    createdAt,
  });
  yield* tx
    .update(replicaState)
    .set({
      nextClientSequence: decision.nextClientSequence,
      localCommitVersion: state.localCommitVersion + 1,
    })
    .where(eq(replicaState.id, state.id));
  return { status: "pending", projection } satisfies SavedLocalCommand;
});

const undoLocalEffects = Effect.fn("ReplicaCommands.undoLocalEffects")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, operationId));
  return yield* restorePendingProjection(tx, operationId);
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
  const pending = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "pending"))
    .all();
  const row = nextUploadClaim(Array.sort(pending, byClientSequence));
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

export type SettledCommand = {
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

const hasUnsentCommands = (tx: ReplicaDb) =>
  tx
    .select({ operationId: commandOutbox.operationId })
    .from(commandOutbox)
    .where(inArray(commandOutbox.status, [...OUTSTANDING_COMMAND_STATUSES]))
    .get()
    .pipe(Effect.map((row) => row !== undefined));

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

export const openReplicaIdentity = Effect.fn("ReplicaCommands.openReplicaIdentity")(function* (
  tx: ReplicaDb,
  input: {
    readonly replicaId: string;
    readonly adoptPendingOutbox: boolean;
  },
) {
  const state = yield* loadReplicaState(tx);
  if (state.replicaId === input.replicaId) return;
  const unsent = yield* hasUnsentCommands(tx);
  if (unsent && !input.adoptPendingOutbox) {
    return yield* Effect.fail(
      syncProtocolError(
        "REPLICA_OWNED_BY_OTHER",
        "Unsent commands remain for the previous replica identity.",
      ),
    );
  }
  if (unsent) {
    const rows = yield* tx.select().from(commandOutbox).all();
    for (const row of rows) {
      const envelope = yield* parseStoredEnvelope(row);
      yield* updateOutbox(tx, row.operationId, {
        envelopeJson: encodeEnvelopeJson({ ...envelope, replicaId: input.replicaId }),
      });
    }
  }
  yield* tx
    .update(replicaState)
    .set({ replicaId: input.replicaId, registeredAt: null })
    .where(eq(replicaState.id, state.id));
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
  function* (tx: ReplicaDb, staleBefore: number) {
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
