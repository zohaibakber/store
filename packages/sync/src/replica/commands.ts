import {
  compareDecimalSequence,
  incrementDecimalSequence,
  SyncCommandEnvelope,
  syncProtocolError,
  type CommandReceipt,
} from "@store/contracts";
import {
  batches,
  commandOutbox,
  products,
  replicaState,
  stockOverlays,
} from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite } from "../sqlite";
import type { ReplicaDb } from "./storage";

export type CommandOutboxStatus = (typeof commandOutbox.$inferSelect)["status"];

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

export type VisibleStock = {
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export const loadReplicaState = (tx: ReplicaDb): typeof replicaState.$inferSelect => {
  const state = tx.select().from(replicaState).get();
  if (!state) throw new Error("Replica state is missing.");
  return state;
};

const bumpLocalCommitVersion = (tx: ReplicaDb): void => {
  const state = loadReplicaState(tx);
  runWrite(
    tx
      .update(replicaState)
      .set({ localCommitVersion: state.localCommitVersion + 1 })
      .where(eq(replicaState.id, state.id)),
  );
};

export const visibleBatchStock = (tx: ReplicaDb, batchId: string): VisibleStock | undefined => {
  const batch = tx.select().from(batches).where(eq(batches.id, batchId)).get();
  if (!batch) return undefined;
  const overlays = tx.select().from(stockOverlays).where(eq(stockOverlays.batchId, batchId)).all();
  return {
    packQuantity:
      batch.packQuantity + overlays.reduce((sum, overlay) => sum + overlay.packDelta, 0),
    unitQuantity:
      batch.unitQuantity + overlays.reduce((sum, overlay) => sum + overlay.unitDelta, 0),
  };
};

export const commandStatus = (
  tx: ReplicaDb,
  operationId: string,
): CommandOutboxStatus | undefined =>
  tx.select().from(commandOutbox).where(eq(commandOutbox.operationId, operationId)).get()?.status;

export const parseStoredEnvelope = (
  row: typeof commandOutbox.$inferSelect,
): SyncCommandEnvelope => {
  const envelope = Schema.decodeUnknownSync(SyncCommandEnvelope)(JSON.parse(row.envelopeJson));
  if (envelope.operationId !== row.operationId || envelope.clientSequence !== row.clientSequence) {
    throw syncProtocolError(
      "COMMAND_IDENTITY_MISMATCH",
      "The stored command identity does not match its outbox row.",
    );
  }
  return envelope;
};

export const overlayForAllocation = (
  tx: ReplicaDb,
  envelope: SyncCommandEnvelope,
): ReadonlyArray<typeof stockOverlays.$inferInsert> => {
  if (envelope.command._tag !== "issueInvoice") return [];
  const command = envelope.command.payload;
  const overlays: Array<typeof stockOverlays.$inferInsert> = [];
  const working = new Map<string, VisibleStock>();
  for (const take of command.allocations) {
    const product = tx.select().from(products).where(eq(products.id, take.productId)).get();
    const unitsPerPack = product?.unitsPerPack ?? 1;
    const current = working.get(take.batchId) ??
      visibleBatchStock(tx, take.batchId) ?? { packQuantity: 0, unitQuantity: 0 };
    const packDelta = take.quantityType === "pack" ? -take.quantity : -take.packsOpened;
    const unitDelta =
      take.quantityType === "pack" ? 0 : take.packsOpened * unitsPerPack - take.quantity;
    working.set(take.batchId, {
      packQuantity: current.packQuantity + packDelta,
      unitQuantity: current.unitQuantity + unitDelta,
    });
    overlays.push({
      commandId: envelope.operationId,
      batchId: take.batchId,
      packDelta,
      unitDelta,
    });
  }
  return overlays;
};

export const saveLocalCommand = (
  tx: ReplicaDb,
  envelope: SyncCommandEnvelope,
  createdAt: number,
): CommandOutboxStatus => {
  const existing = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, envelope.operationId))
    .get();
  if (existing) {
    const stored = parseStoredEnvelope(existing);
    if (JSON.stringify(stored) !== JSON.stringify(envelope)) {
      throw syncProtocolError("OPERATION_ID_REUSED", "The local command id was reused.");
    }
    return existing.status;
  }
  const state = loadReplicaState(tx);
  if (envelope.organizationId !== state.organizationId) {
    throw syncProtocolError(
      "ORGANIZATION_MISMATCH",
      "The local command belongs to another organization.",
    );
  }
  if (envelope.epoch !== state.epoch) {
    throw syncProtocolError("EPOCH_MISMATCH", "The local command uses another epoch.");
  }
  if (envelope.replicaId !== state.replicaId) {
    throw syncProtocolError(
      "COMMAND_IDENTITY_MISMATCH",
      "The local command belongs to another replica.",
    );
  }
  if (envelope.clientSequence !== state.nextClientSequence) {
    throw syncProtocolError(
      "REPLICA_SEQUENCE_GAP",
      `Expected replica sequence ${state.nextClientSequence}, received ${envelope.clientSequence}.`,
    );
  }
  for (const overlay of overlayForAllocation(tx, envelope)) {
    runWrite(tx.insert(stockOverlays).values(overlay));
  }
  runWrite(
    tx.insert(commandOutbox).values({
      operationId: envelope.operationId,
      status: "pending",
      envelopeJson: JSON.stringify(envelope),
      receiptJson: null,
      clientSequence: envelope.clientSequence,
      createdAt,
    }),
  );
  runWrite(
    tx
      .update(replicaState)
      .set({
        nextClientSequence: incrementDecimalSequence(state.nextClientSequence),
        localCommitVersion: state.localCommitVersion + 1,
      })
      .where(eq(replicaState.id, state.id)),
  );
  return "pending" as const;
};

const lowestPendingRow = (tx: ReplicaDb): typeof commandOutbox.$inferSelect | undefined => {
  const rows = tx.select().from(commandOutbox).where(eq(commandOutbox.status, "pending")).all();
  let lowest: typeof commandOutbox.$inferSelect | undefined;
  for (const row of rows) {
    if (
      lowest === undefined ||
      compareDecimalSequence(row.clientSequence, lowest.clientSequence) < 0
    ) {
      lowest = row;
    }
  }
  return lowest;
};

export const claimNextUpload = (
  tx: ReplicaDb,
  input: ClaimNextUploadInput,
): UploadClaim | undefined => {
  const outstanding = tx
    .select({ operationId: commandOutbox.operationId })
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "sending"))
    .get();
  if (outstanding) return undefined;
  const row = lowestPendingRow(tx);
  if (!row) return undefined;
  const envelope = parseStoredEnvelope(row);
  runWrite(
    tx
      .update(commandOutbox)
      .set({
        status: "sending",
        claimId: input.claimId,
        claimedAt: input.claimedAt,
        attempts: row.attempts + 1,
      })
      .where(eq(commandOutbox.operationId, row.operationId)),
  );
  bumpLocalCommitVersion(tx);
  return {
    operationId: row.operationId,
    claimId: input.claimId,
    claimedAt: input.claimedAt,
    attempts: row.attempts + 1,
    outcomeUncertain: row.outcomeUncertain,
    envelope,
  };
};

const validateReceipt = (envelope: SyncCommandEnvelope, receipt: CommandReceipt): void => {
  if (
    receipt.operationId !== envelope.operationId ||
    receipt.replicaId !== envelope.replicaId ||
    receipt.clientSequence !== envelope.clientSequence ||
    receipt.payloadHash !== envelope.payloadHash
  ) {
    throw syncProtocolError(
      "COMMAND_IDENTITY_MISMATCH",
      "The command receipt does not match the stored command.",
    );
  }
};

const settleCommandReceipt = (
  tx: ReplicaDb,
  receipt: CommandReceipt,
  claimId?: string,
): CommandOutboxStatus | undefined => {
  const row = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, receipt.operationId))
    .get();
  if (!row) return undefined;
  if (claimId !== undefined && (row.status !== "sending" || row.claimId !== claimId)) {
    return row.status;
  }
  const envelope = parseStoredEnvelope(row);
  validateReceipt(envelope, receipt);
  if (row.status === "abandoned") return row.status;
  if (row.status === "integrated") {
    if (receipt.decision !== "accepted") {
      throw syncProtocolError(
        "COMMAND_IDENTITY_MISMATCH",
        "An integrated command received a rejected receipt.",
      );
    }
    runWrite(
      tx
        .update(commandOutbox)
        .set({
          receiptJson: JSON.stringify(receipt),
          commitSequence: receipt.commitSequence,
          claimId: null,
          claimedAt: null,
          outcomeUncertain: false,
        })
        .where(eq(commandOutbox.operationId, receipt.operationId)),
    );
    return "integrated" as const;
  }
  if (receipt.decision === "rejected") {
    runWrite(tx.delete(stockOverlays).where(eq(stockOverlays.commandId, receipt.operationId)));
    runWrite(
      tx
        .update(commandOutbox)
        .set({
          status: "rejected",
          receiptJson: JSON.stringify(receipt),
          commitSequence: receipt.commitSequence,
          claimId: null,
          claimedAt: null,
          outcomeUncertain: false,
        })
        .where(eq(commandOutbox.operationId, receipt.operationId)),
    );
    bumpLocalCommitVersion(tx);
    return "rejected" as const;
  }
  runWrite(
    tx
      .update(commandOutbox)
      .set({
        status: "accepted_awaiting_integration",
        receiptJson: JSON.stringify(receipt),
        commitSequence: receipt.commitSequence,
        claimId: null,
        claimedAt: null,
        outcomeUncertain: false,
      })
      .where(eq(commandOutbox.operationId, receipt.operationId)),
  );
  bumpLocalCommitVersion(tx);
  return "accepted_awaiting_integration" as const;
};

export const recordCommandReceipt = (
  tx: ReplicaDb,
  receipt: CommandReceipt,
): CommandOutboxStatus | undefined => settleCommandReceipt(tx, receipt);

export const settleUploadClaim = (
  tx: ReplicaDb,
  claimId: string,
  receipt: CommandReceipt,
): CommandOutboxStatus | undefined => settleCommandReceipt(tx, receipt, claimId);

export const releaseUploadClaim = (
  tx: ReplicaDb,
  operationId: string,
  claimId: string,
): CommandOutboxStatus | undefined => {
  const row = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, operationId))
    .get();
  if (!row || row.status !== "sending" || row.claimId !== claimId) return row?.status;
  runWrite(
    tx
      .update(commandOutbox)
      .set({
        status: "pending",
        claimId: null,
        claimedAt: null,
        outcomeUncertain: true,
      })
      .where(eq(commandOutbox.operationId, operationId)),
  );
  bumpLocalCommitVersion(tx);
  return "pending" as const;
};

export const hasUnsentCommands = (tx: ReplicaDb): boolean => {
  const statuses: ReadonlyArray<CommandOutboxStatus> = [
    "pending",
    "sending",
    "accepted_awaiting_integration",
  ];
  for (const status of statuses) {
    const row = tx
      .select({ operationId: commandOutbox.operationId })
      .from(commandOutbox)
      .where(eq(commandOutbox.status, status))
      .get();
    if (row) return true;
  }
  return false;
};

export const verifyReplicaIncarnation = (tx: ReplicaDb, incarnation: string): void => {
  const state = loadReplicaState(tx);
  if (state.incarnation !== incarnation) {
    throw syncProtocolError(
      "INCARNATION_MISMATCH",
      `Expected incarnation ${state.incarnation}, received ${incarnation}.`,
    );
  }
};

export const verifyAuthorityHeadNotBehind = (tx: ReplicaDb, authorityHorizon: string): void => {
  const state = loadReplicaState(tx);
  if (compareDecimalSequence(state.appliedCommitSequence, authorityHorizon) > 0) {
    throw syncProtocolError(
      "SNAPSHOT_REQUIRED",
      `Local applied cursor ${state.appliedCommitSequence} is ahead of authority horizon ${authorityHorizon}.`,
    );
  }
};

export const openReplicaIdentity = (
  tx: ReplicaDb,
  input: {
    readonly replicaId: string;
    readonly adoptPendingOutbox: boolean;
  },
): void => {
  const state = loadReplicaState(tx);
  if (state.replicaId === input.replicaId) return;
  if (!hasUnsentCommands(tx)) {
    runWrite(
      tx
        .update(replicaState)
        .set({ replicaId: input.replicaId })
        .where(eq(replicaState.id, state.id)),
    );
    return;
  }
  if (!input.adoptPendingOutbox) {
    throw syncProtocolError(
      "REPLICA_OWNED_BY_OTHER",
      "Unsent commands remain for the previous replica identity.",
    );
  }
  const rows = tx.select().from(commandOutbox).all();
  for (const row of rows) {
    const envelope = parseStoredEnvelope(row);
    const adopted = {
      ...envelope,
      replicaId: input.replicaId,
    };
    runWrite(
      tx
        .update(commandOutbox)
        .set({ envelopeJson: JSON.stringify(adopted) })
        .where(eq(commandOutbox.operationId, row.operationId)),
    );
  }
  runWrite(
    tx
      .update(replicaState)
      .set({ replicaId: input.replicaId })
      .where(eq(replicaState.id, state.id)),
  );
};

export const recoverStaleUploadClaims = (tx: ReplicaDb, staleBefore: number): number => {
  const stale = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "sending"))
    .all()
    .filter((row) => row.claimedAt === null || row.claimedAt <= staleBefore);
  for (const row of stale) {
    runWrite(
      tx
        .update(commandOutbox)
        .set({
          status: "pending",
          claimId: null,
          claimedAt: null,
          outcomeUncertain: true,
        })
        .where(eq(commandOutbox.operationId, row.operationId)),
    );
  }
  if (stale.length > 0) bumpLocalCommitVersion(tx);
  return stale.length;
};
