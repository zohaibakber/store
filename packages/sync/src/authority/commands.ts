import {
  allocationsCoverInput,
  AuthorityIncarnation,
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  MAX_COMMAND_ATTEMPTS,
  nextInvoiceNumber,
  OrgCommitSequence,
  padDecimalSequence,
  ReplicaClientSequence,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncLogChange,
  SyncProtocolError,
  syncProtocolError,
  type SyncSubscription,
  unpadDecimalSequence,
  type AcceptedInvoiceResult,
  type RegisterReplicaRequest,
  type RegisterReplicaResult,
  type SyncCommandEnvelope,
  type SyncPullResult,
} from "@store/contracts";
import { decodeInvoiceId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  batches,
  commandReceipts,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  invoiceItems,
  invoices,
  products,
  replicas,
  stockMovements,
} from "@store/db/inventory.schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite, SqliteTransactionAborted, type SqliteConnection } from "../sqlite";

export type InventoryActor = {
  readonly organizationId: string;
  readonly userId: string;
};

export type InventoryDb = SqliteConnection;

const fail = (code: Parameters<typeof syncProtocolError>[0], message: string): never => {
  throw syncProtocolError(code, message);
};

const isSyncProtocolError = Schema.is(SyncProtocolError);

const parseReceipt = (row: typeof commandReceipts.$inferSelect): CommandReceipt =>
  Schema.decodeUnknownSync(CommandReceipt)({
    operationId: row.operationId,
    replicaId: row.replicaId,
    clientSequence: unpadDecimalSequence(row.clientSequence),
    payloadHash: row.payloadHash,
    decision: row.decision,
    commitSequence: unpadDecimalSequence(row.commitSequence),
    result: JSON.parse(row.resultJson),
  });

const requireReadyState = (tx: InventoryDb, organizationId: string) => {
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .get();
  if (!state || state.status !== "ready") {
    return fail("EPOCH_MISMATCH", "This organization inventory is not ready.");
  }
  return state;
};

const writeLog = (
  tx: InventoryDb,
  input: {
    readonly organizationId: string;
    readonly commitSequence: string;
    readonly operationId: string;
    readonly decision: "accepted" | "rejected";
    readonly epoch: string;
    readonly changes: ReadonlyArray<SyncLogChange>;
  },
) => {
  runWrite(
    tx.insert(inventoryTransactions).values({
      organizationId: input.organizationId,
      commitSequence: input.commitSequence,
      operationId: input.operationId,
      decision: input.decision,
      epoch: input.epoch,
    }),
  );
  for (const [ordinal, change] of input.changes.entries()) {
    runWrite(
      tx.insert(inventoryChanges).values({
        organizationId: input.organizationId,
        commitSequence: input.commitSequence,
        ordinal,
        entity: change.entity,
        action: change.action,
        entityId: change.entityId,
        rowVersion: change.rowVersion,
        rowJson: JSON.stringify(change.row),
      }),
    );
  }
};

const insertInvoice = (
  tx: InventoryDb,
  actor: InventoryActor,
  command: Extract<SyncCommandEnvelope["command"], { readonly _tag: "issueInvoice" }>["payload"],
  total: number,
) => {
  const values = (invoiceNumber: number) => ({
    id: command.invoiceId,
    invoiceNumber,
    customerName: command.input.customerName?.trim() || null,
    total,
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: command.deviceId,
    operationId: command.commandId,
    rowVersion: 1,
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt,
    deletedAt: null,
  });
  const inserted = tx
    .insert(invoices)
    .values(values(command.invoiceNumber))
    .onConflictDoNothing({
      target: [invoices.organizationId, invoices.invoiceNumber],
    })
    .returning()
    .get();
  if (inserted) return inserted;
  const latest = tx
    .select({
      lastInvoiceNumber: sql`coalesce(max(${invoices.invoiceNumber}), 0)`.mapWith(Number),
    })
    .from(invoices)
    .where(eq(invoices.organizationId, actor.organizationId))
    .get();
  const retry = tx
    .insert(invoices)
    .values(values(nextInvoiceNumber([latest?.lastInvoiceNumber ?? 0])))
    .onConflictDoNothing({
      target: [invoices.organizationId, invoices.invoiceNumber],
    })
    .returning()
    .get();
  if (!retry) return fail("ENTITY_WRITE_FAILED", "The invoice could not be created.");
  return retry;
};

interface IssuedInvoice {
  readonly result: AcceptedInvoiceResult;
  readonly changes: ReadonlyArray<SyncLogChange>;
}

const issueInvoice = (
  tx: InventoryDb,
  actor: InventoryActor,
  envelope: SyncCommandEnvelope,
): IssuedInvoice => {
  if (envelope.command._tag !== "issueInvoice") {
    return fail("INVALID_OPERATION", "Only issueInvoice is implemented.");
  }
  const command = envelope.command.payload;
  if (command.commandId !== envelope.operationId) {
    return fail(
      "COMMAND_IDENTITY_MISMATCH",
      "The invoice command id must match the envelope operation id.",
    );
  }
  if (command.input.items.length === 0) {
    return fail("INVALID_OPERATION", "Add at least one item to the sale.");
  }
  if (!allocationsCoverInput(command.input, command.allocations)) {
    return fail("INVALID_OPERATION", "The sale allocations do not match the items.");
  }

  const existingInvoice = tx
    .select({ operationId: invoices.operationId })
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, actor.organizationId), eq(invoices.id, command.invoiceId)),
    )
    .get();
  if (existingInvoice && existingInvoice.operationId !== command.commandId) {
    return fail("INVOICE_IDENTITY_CONFLICT", "This invoice id is already in use.");
  }

  type TakePlan = {
    readonly take: (typeof command.allocations)[number];
    readonly product: typeof products.$inferSelect;
    readonly batch: typeof batches.$inferSelect;
    readonly nextPackQuantity: number;
    readonly nextUnitQuantity: number;
    readonly packsOpened: number;
  };
  const plans: TakePlan[] = [];
  const working = new Map<string, typeof batches.$inferSelect>();
  for (const take of command.allocations) {
    const product = tx
      .select()
      .from(products)
      .where(
        and(eq(products.organizationId, actor.organizationId), eq(products.id, take.productId)),
      )
      .get();
    if (!product || product.deletedAt !== null) {
      return fail("INSUFFICIENT_STOCK", "One of the products no longer exists.");
    }
    const current =
      working.get(take.batchId) ??
      tx
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, actor.organizationId),
            eq(batches.id, take.batchId),
            eq(batches.productId, product.id),
          ),
        )
        .get();
    if (!current || current.deletedAt !== null) {
      return fail("INSUFFICIENT_STOCK", `The selected batch for ${product.name} is gone.`);
    }
    const available =
      take.quantityType === "pack"
        ? current.packQuantity
        : current.packQuantity * product.unitsPerPack + current.unitQuantity;
    if (available < take.quantity) {
      return fail(
        "INSUFFICIENT_STOCK",
        `Not enough stock for ${product.name}: ${available} available, ${take.quantity} requested.`,
      );
    }
    const packsOpened =
      take.quantityType === "unit"
        ? Math.max(0, Math.ceil((take.quantity - current.unitQuantity) / product.unitsPerPack))
        : 0;
    const nextPackQuantity =
      take.quantityType === "pack"
        ? current.packQuantity - take.quantity
        : current.packQuantity - packsOpened;
    const nextUnitQuantity =
      take.quantityType === "pack"
        ? current.unitQuantity
        : current.unitQuantity + packsOpened * product.unitsPerPack - take.quantity;
    if (nextPackQuantity < 0 || nextUnitQuantity < 0) {
      return fail("INSUFFICIENT_STOCK", `Not enough stock for ${product.name}.`);
    }
    const nextBatch = {
      ...current,
      packQuantity: nextPackQuantity,
      unitQuantity: nextUnitQuantity,
    };
    working.set(take.batchId, nextBatch);
    plans.push({ take, product, batch: current, nextPackQuantity, nextUnitQuantity, packsOpened });
  }

  const total = command.input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
  const invoiceRow = insertInvoice(tx, actor, command, total);
  const changes: SyncLogChange[] = [
    {
      entity: "invoice",
      action: "upsert",
      entityId: invoiceRow.id,
      rowVersion: 1,
      row: invoiceRow,
    },
  ];

  for (const plan of plans) {
    const updatedBatch = {
      ...plan.batch,
      packQuantity: plan.nextPackQuantity,
      unitQuantity: plan.nextUnitQuantity,
      updatedByUserId: actor.userId,
      deviceId: command.deviceId,
      operationId: command.commandId,
      rowVersion: plan.batch.rowVersion + 1,
      updatedAt: command.occurredAt,
    };
    runWrite(
      tx
        .update(batches)
        .set({
          packQuantity: updatedBatch.packQuantity,
          unitQuantity: updatedBatch.unitQuantity,
          updatedByUserId: updatedBatch.updatedByUserId,
          deviceId: updatedBatch.deviceId,
          operationId: updatedBatch.operationId,
          rowVersion: updatedBatch.rowVersion,
          updatedAt: updatedBatch.updatedAt,
        })
        .where(
          and(eq(batches.organizationId, actor.organizationId), eq(batches.id, plan.batch.id)),
        ),
    );

    const itemRow = {
      id: plan.take.invoiceItemId,
      invoiceId: invoiceRow.id,
      productId: plan.product.id,
      batchId: plan.batch.id,
      productName: plan.product.name,
      batchNumber: plan.batch.batchNumber,
      quantity: plan.take.quantity,
      quantityType: plan.take.quantityType,
      baseUnitQuantity:
        plan.take.quantity * (plan.take.quantityType === "pack" ? plan.product.unitsPerPack : 1),
      salePrice: plan.take.salePrice,
      organizationId: actor.organizationId,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
      deviceId: command.deviceId,
      operationId: command.commandId,
      rowVersion: 1,
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt,
      deletedAt: null,
    };
    runWrite(tx.insert(invoiceItems).values(itemRow));
    changes.push(
      {
        entity: "batch",
        action: "upsert",
        entityId: updatedBatch.id,
        rowVersion: updatedBatch.rowVersion,
        row: updatedBatch,
      },
      {
        entity: "invoiceItem",
        action: "upsert",
        entityId: itemRow.id,
        rowVersion: 1,
        row: itemRow,
      },
    );
    if (plan.packsOpened > 0) {
      const openPack = {
        id: plan.take.openPackMovementId ?? `${plan.take.saleMovementId}:open-pack`,
        productId: plan.product.id,
        batchId: plan.batch.id,
        invoiceId: invoiceRow.id,
        type: "open_pack" as const,
        packDelta: -plan.packsOpened,
        unitDelta: plan.packsOpened * plan.product.unitsPerPack,
        note: `Opened for invoice #${invoiceRow.invoiceNumber}`,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      };
      runWrite(tx.insert(stockMovements).values(openPack));
      changes.push({
        entity: "stockMovement",
        action: "upsert",
        entityId: openPack.id,
        rowVersion: 1,
        row: openPack,
      });
    }
    const saleMovement = {
      id: plan.take.saleMovementId,
      productId: plan.product.id,
      batchId: plan.batch.id,
      invoiceId: invoiceRow.id,
      type: "sale" as const,
      packDelta: plan.take.quantityType === "pack" ? -plan.take.quantity : 0,
      unitDelta: plan.take.quantityType === "unit" ? -plan.take.quantity : 0,
      note: `Invoice #${invoiceRow.invoiceNumber}`,
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      deviceId: command.deviceId,
      operationId: command.commandId,
      createdAt: command.occurredAt,
    };
    runWrite(tx.insert(stockMovements).values(saleMovement));
    changes.push({
      entity: "stockMovement",
      action: "upsert",
      entityId: saleMovement.id,
      rowVersion: 1,
      row: saleMovement,
    });
  }

  return {
    result: {
      _tag: "issueInvoice",
      invoiceId: decodeInvoiceId(invoiceRow.id),
      invoiceNumber: invoiceRow.invoiceNumber,
    },
    changes,
  };
};

export const commitPreparedCommand = (
  tx: InventoryDb,
  input: {
    readonly actor: InventoryActor;
    readonly envelope: SyncCommandEnvelope;
    readonly receivedAt: number;
    readonly isolateAttempt?: <A>(run: () => A) => A;
  },
): CommandReceipt => {
  const { actor, envelope } = input;
  const isolateAttempt = input.isolateAttempt ?? (<A>(run: () => A) => run());
  if (envelope.organizationId !== actor.organizationId) {
    return fail("ORGANIZATION_MISMATCH", "The command does not belong to the active organization.");
  }
  if (envelope.payloadHash !== canonicalPayloadHash(envelope.command)) {
    return fail("INVALID_PAYLOAD_HASH", "The payload hash does not match.");
  }

  const state = requireReadyState(tx, actor.organizationId);
  if (state.epoch !== envelope.epoch) {
    return fail("EPOCH_MISMATCH", "The replica epoch does not match.");
  }

  const existing = tx
    .select()
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.organizationId, actor.organizationId),
        eq(commandReceipts.operationId, envelope.operationId),
      ),
    )
    .get();
  if (existing) {
    if (existing.payloadHash !== envelope.payloadHash) {
      return fail("OPERATION_ID_REUSED", "The command id was reused.");
    }
    return parseReceipt(existing);
  }

  const replica = tx
    .select()
    .from(replicas)
    .where(
      and(
        eq(replicas.organizationId, actor.organizationId),
        eq(replicas.replicaId, envelope.replicaId),
      ),
    )
    .get();
  if (!replica) {
    return fail("REPLICA_UNKNOWN", "This replica is not registered.");
  }
  if (replica.ownerUserId !== actor.userId) {
    return fail("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
  }
  const expectedSequence = incrementDecimalSequence(
    unpadDecimalSequence(replica.lastClientSequence),
  );
  if (envelope.clientSequence !== expectedSequence) {
    return fail(
      "REPLICA_SEQUENCE_GAP",
      `Expected client sequence ${expectedSequence}, received ${envelope.clientSequence}.`,
    );
  }

  let decision: CommandReceipt["decision"] = "accepted";
  let result: CommandReceipt["result"];
  let changes: ReadonlyArray<SyncLogChange> = [];
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const issued = isolateAttempt(() => issueInvoice(tx, actor, envelope));
      result = issued.result;
      changes = issued.changes;
      break;
    } catch (cause) {
      if (cause instanceof SqliteTransactionAborted) throw cause;
      if (isSyncProtocolError(cause)) {
        if (cause.code === "INSUFFICIENT_STOCK") {
          decision = "rejected";
          result = {
            _tag: "rejected",
            code: "INSUFFICIENT_STOCK",
            message: cause.message,
          };
          break;
        }
        throw cause;
      }
      if (attempts >= MAX_COMMAND_ATTEMPTS) {
        decision = "rejected";
        result = {
          _tag: "rejected",
          code: "COMMAND_ABANDONED",
          message: "The command could not be applied.",
        };
        break;
      }
    }
  }

  const commitSequence = padDecimalSequence(
    incrementDecimalSequence(unpadDecimalSequence(state.commitSequence)),
  );
  runWrite(
    tx
      .update(inventoryState)
      .set({ commitSequence })
      .where(eq(inventoryState.organizationId, actor.organizationId)),
  );
  writeLog(tx, {
    organizationId: actor.organizationId,
    commitSequence,
    operationId: envelope.operationId,
    decision,
    epoch: envelope.epoch,
    changes,
  });
  runWrite(
    tx.insert(commandReceipts).values({
      organizationId: actor.organizationId,
      operationId: envelope.operationId,
      replicaId: envelope.replicaId,
      clientSequence: padDecimalSequence(envelope.clientSequence),
      payloadHash: envelope.payloadHash,
      decision,
      commitSequence,
      resultJson: JSON.stringify(result),
      receivedAt: input.receivedAt,
      attempts,
    }),
  );
  runWrite(
    tx
      .update(replicas)
      .set({ lastClientSequence: padDecimalSequence(envelope.clientSequence) })
      .where(
        and(
          eq(replicas.organizationId, actor.organizationId),
          eq(replicas.replicaId, envelope.replicaId),
        ),
      ),
  );

  return {
    operationId: envelope.operationId,
    replicaId: envelope.replicaId,
    clientSequence: envelope.clientSequence,
    payloadHash: envelope.payloadHash,
    decision,
    commitSequence: OrgCommitSequence.make(unpadDecimalSequence(commitSequence)),
    result,
  };
};

export const registerReplica = (
  tx: InventoryDb,
  actor: InventoryActor,
  request: RegisterReplicaRequest,
  now: number,
): RegisterReplicaResult => {
  const state = requireReadyState(tx, actor.organizationId);
  const existing = tx
    .select()
    .from(replicas)
    .where(
      and(
        eq(replicas.organizationId, actor.organizationId),
        eq(replicas.replicaId, request.replicaId),
      ),
    )
    .get();
  if (existing) {
    if (existing.ownerUserId !== actor.userId) {
      return fail("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }
    if (request.deviceLabel !== undefined) {
      runWrite(
        tx
          .update(replicas)
          .set({ deviceLabel: request.deviceLabel })
          .where(
            and(
              eq(replicas.organizationId, actor.organizationId),
              eq(replicas.replicaId, request.replicaId),
            ),
          ),
      );
    }
    return {
      replicaId: existing.replicaId,
      epoch: SyncEpoch.make(state.epoch),
      nextClientSequence: ReplicaClientSequence.make(
        incrementDecimalSequence(unpadDecimalSequence(existing.lastClientSequence)),
      ),
      incarnation: AuthorityIncarnation.make(state.incarnation),
      retentionFloor: OrgCommitSequence.make(unpadDecimalSequence(state.retentionFloor)),
      horizon: OrgCommitSequence.make(unpadDecimalSequence(state.commitSequence)),
      schemaVersion: SYNC_SCHEMA_VERSION,
    };
  }
  runWrite(
    tx.insert(replicas).values({
      organizationId: actor.organizationId,
      replicaId: request.replicaId,
      ownerUserId: actor.userId,
      deviceLabel: request.deviceLabel ?? null,
      lastClientSequence: padDecimalSequence("0"),
      processedThroughClientSequence: padDecimalSequence("0"),
      registeredAt: now,
      lastSeenAt: now,
    }),
  );
  return {
    replicaId: request.replicaId,
    epoch: SyncEpoch.make(state.epoch),
    nextClientSequence: ReplicaClientSequence.make("1"),
    incarnation: AuthorityIncarnation.make(state.incarnation),
    retentionFloor: OrgCommitSequence.make(unpadDecimalSequence(state.retentionFloor)),
    horizon: OrgCommitSequence.make(unpadDecimalSequence(state.commitSequence)),
    schemaVersion: SYNC_SCHEMA_VERSION,
  };
};

export const getReceipt = (
  tx: InventoryDb,
  actor: InventoryActor,
  operationId: string,
): CommandReceipt | undefined => {
  requireReadyState(tx, actor.organizationId);
  const row = tx
    .select()
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.organizationId, actor.organizationId),
        eq(commandReceipts.operationId, operationId),
      ),
    )
    .get();
  return row ? parseReceipt(row) : undefined;
};

export const pullTransactions = (
  tx: InventoryDb,
  input: {
    readonly organizationId: string;
    readonly epoch: string;
    readonly subscription: SyncSubscription;
    readonly afterCommitSequence: string;
    readonly limit: number;
  },
): SyncPullResult => {
  const state = requireReadyState(tx, input.organizationId);
  if (state.epoch !== input.epoch) {
    return fail("EPOCH_MISMATCH", "The replica epoch does not match.");
  }
  const retentionFloor = unpadDecimalSequence(state.retentionFloor);
  if (compareDecimalSequence(input.afterCommitSequence, retentionFloor) < 0) {
    return fail(
      "SNAPSHOT_REQUIRED",
      "This replica is behind the retained history and needs a snapshot.",
    );
  }
  const headers = tx
    .select()
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, input.organizationId),
        gt(inventoryTransactions.commitSequence, padDecimalSequence(input.afterCommitSequence)),
      ),
    )
    .orderBy(asc(inventoryTransactions.commitSequence))
    .limit(input.limit)
    .all();
  const transactions = headers.map((header) => {
    const rows = tx
      .select()
      .from(inventoryChanges)
      .where(
        and(
          eq(inventoryChanges.organizationId, input.organizationId),
          eq(inventoryChanges.commitSequence, header.commitSequence),
        ),
      )
      .orderBy(asc(inventoryChanges.ordinal))
      .all();
    return {
      commitSequence: OrgCommitSequence.make(unpadDecimalSequence(header.commitSequence)),
      operationId: header.operationId,
      decision: header.decision,
      changes: rows.map((row) =>
        Schema.decodeUnknownSync(SyncLogChange)({
          entity: row.entity,
          action: row.action,
          entityId: row.entityId,
          rowVersion: row.rowVersion,
          row: JSON.parse(row.rowJson),
        }),
      ),
    };
  });
  const last = transactions.at(-1);
  return {
    epoch: SyncEpoch.make(state.epoch),
    incarnation: AuthorityIncarnation.make(state.incarnation),
    subscription: input.subscription,
    schemaVersion: SYNC_SCHEMA_VERSION,
    transactions,
    nextCommitSequence:
      last?.commitSequence ??
      OrgCommitSequence.make(unpadDecimalSequence(input.afterCommitSequence)),
    horizon: OrgCommitSequence.make(unpadDecimalSequence(state.commitSequence)),
    retentionFloor: OrgCommitSequence.make(retentionFloor),
  };
};
