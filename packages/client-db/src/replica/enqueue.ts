import { SyncCommandEnvelope, type SyncEntity } from "@store/contracts";
import { decideOverlays } from "@store/sync";
import * as Schema from "effect/Schema";

import type { ReplicaHandle, ReplicaSqlExecutor } from "./types";

const unitsPerPackRow = Schema.Struct({
  unitsPerPack: Schema.Number,
});

const stockRow = Schema.Struct({
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
  overlayPack: Schema.Number,
  overlayUnit: Schema.Number,
});

const encodeEnvelopeJson = Schema.encodeSync(Schema.fromJsonString(SyncCommandEnvelope));

export type EnqueueLocalResult = {
  readonly status: "pending" | "replay";
  readonly changed: boolean;
};

const rollbackFailedTransaction = async (replica: ReplicaSqlExecutor): Promise<void> => {
  try {
    await Promise.resolve(replica.query("ROLLBACK", []));
  } catch {
    return;
  }
};

const enqueueViaSql = async (
  replica: ReplicaSqlExecutor,
  envelope: SyncCommandEnvelope,
  createdAt: number,
): Promise<EnqueueLocalResult> => {
  const existing = await replica.query(`select status from command_outbox where operationId = ?`, [
    envelope.operationId,
  ]);
  if (existing[0]) {
    return { status: "replay", changed: false };
  }

  const cachePacks = new Map<string, number>();
  const cacheStock = new Map<string, { packQuantity: number; unitQuantity: number }>();

  if (envelope.command._tag === "issueInvoice") {
    for (const take of envelope.command.payload.allocations) {
      if (!cachePacks.has(take.productId)) {
        const rows = await replica.query(`select unitsPerPack from products where id = ?`, [
          take.productId,
        ]);
        const decoded = Schema.decodeUnknownSync(unitsPerPackRow)(rows[0] ?? { unitsPerPack: 1 });
        cachePacks.set(take.productId, decoded.unitsPerPack);
      }
      if (!cacheStock.has(take.batchId)) {
        const rows = await replica.query(
          `select
            coalesce(b.packQuantity, 0) as packQuantity,
            coalesce(b.unitQuantity, 0) as unitQuantity,
            coalesce((select sum(packDelta) from stock_overlays where batchId = b.id), 0) as overlayPack,
            coalesce((select sum(unitDelta) from stock_overlays where batchId = b.id), 0) as overlayUnit
           from batches b where b.id = ?`,
          [take.batchId],
        );
        const decoded = Schema.decodeUnknownSync(stockRow)(
          rows[0] ?? { packQuantity: 0, unitQuantity: 0, overlayPack: 0, overlayUnit: 0 },
        );
        cacheStock.set(take.batchId, {
          packQuantity: decoded.packQuantity + decoded.overlayPack,
          unitQuantity: decoded.unitQuantity + decoded.overlayUnit,
        });
      }
    }
  }

  const overlays = decideOverlays(
    envelope,
    (productId) => cachePacks.get(productId) ?? 1,
    (batchId) => cacheStock.get(batchId) ?? { packQuantity: 0, unitQuantity: 0 },
  );

  const encoded = encodeEnvelopeJson(envelope);
  const nextSequence = String(BigInt(envelope.clientSequence) + 1n);

  await replica.query("BEGIN", []);
  try {
    for (const overlay of overlays) {
      await replica.query(
        `insert into stock_overlays (commandId, batchId, packDelta, unitDelta) values (?, ?, ?, ?)`,
        [overlay.commandId, overlay.batchId, overlay.packDelta, overlay.unitDelta],
      );
    }
    await replica.query(
      `insert into command_outbox (
        operationId, status, envelopeJson, clientSequence, createdAt, attempts, outcomeUncertain
      ) values (?, 'pending', ?, ?, ?, 0, 0)`,
      [envelope.operationId, encoded, envelope.clientSequence, createdAt],
    );
    await replica.query(
      `update replica_state set nextClientSequence = ?, localCommitVersion = localCommitVersion + 1 where id = 'singleton'`,
      [nextSequence],
    );
    await replica.query("COMMIT", []);
  } catch (cause) {
    await rollbackFailedTransaction(replica);
    throw cause;
  }

  return { status: "pending", changed: true };
};

export const enqueueLocalCommand = async (
  replica: ReplicaHandle,
  envelope: SyncCommandEnvelope,
  createdAt: number,
): Promise<EnqueueLocalResult> => {
  if (replica.enqueueLocal) {
    const queued = await replica.enqueueLocal(envelope, createdAt);
    return {
      status: queued.changed ? "pending" : "replay",
      changed: queued.changed,
    };
  }
  return enqueueViaSql(replica, envelope, createdAt);
};

export const touchedEntitiesForCommand = (
  envelope: SyncCommandEnvelope,
): ReadonlyArray<SyncEntity> => {
  if (envelope.command._tag === "issueInvoice") {
    return ["invoice", "invoiceItem", "stockMovement", "batch"];
  }
  return [];
};
