import {
  incrementDecimalSequence,
  SyncCommandEnvelope,
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

export type VisibleStock = {
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export const loadReplicaState = (tx: ReplicaDb) => {
  const state = tx.select().from(replicaState).get();
  if (!state) throw new Error("Replica state is missing.");
  return state;
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

const overlayForAllocation = (
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
) => {
  const state = loadReplicaState(tx);
  if (envelope.clientSequence !== state.nextClientSequence) {
    throw new Error(
      `Expected replica sequence ${state.nextClientSequence}, received ${envelope.clientSequence}.`,
    );
  }
  const existing = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, envelope.operationId))
    .get();
  if (existing) return existing.status;
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

export const markCommandSending = (tx: ReplicaDb, operationId: string) => {
  const row = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, operationId))
    .get();
  if (!row || row.status !== "pending") return row?.status;
  runWrite(
    tx
      .update(commandOutbox)
      .set({ status: "sending" })
      .where(eq(commandOutbox.operationId, operationId)),
  );
  return "sending" as const;
};

export const recordCommandReceipt = (tx: ReplicaDb, receipt: CommandReceipt) => {
  const row = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, receipt.operationId))
    .get();
  if (!row) return undefined;
  if (row.status === "integrated") {
    runWrite(
      tx
        .update(commandOutbox)
        .set({ receiptJson: JSON.stringify(receipt) })
        .where(eq(commandOutbox.operationId, receipt.operationId)),
    );
    return "integrated" as const;
  }
  if (receipt.decision === "rejected") {
    runWrite(tx.delete(stockOverlays).where(eq(stockOverlays.commandId, receipt.operationId)));
    runWrite(
      tx
        .update(commandOutbox)
        .set({ status: "rejected", receiptJson: JSON.stringify(receipt) })
        .where(eq(commandOutbox.operationId, receipt.operationId)),
    );
    return "rejected" as const;
  }
  runWrite(
    tx
      .update(commandOutbox)
      .set({
        status: "accepted_awaiting_integration",
        receiptJson: JSON.stringify(receipt),
      })
      .where(eq(commandOutbox.operationId, receipt.operationId)),
  );
  return "accepted_awaiting_integration" as const;
};

export const takePendingCommand = (tx: ReplicaDb): SyncCommandEnvelope | undefined => {
  const row = tx.select().from(commandOutbox).where(eq(commandOutbox.status, "pending")).get();
  if (!row) return undefined;
  markCommandSending(tx, row.operationId);
  return Schema.decodeUnknownSync(SyncCommandEnvelope)(JSON.parse(row.envelopeJson));
};
