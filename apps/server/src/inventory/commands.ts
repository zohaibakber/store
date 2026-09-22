import {
  AcceptedInvoiceResult,
  AuthorityIncarnation,
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  MAX_SYNC_PULL_TRANSACTIONS,
  OrgCommitSequence,
  RejectedCommandResult,
  ReplicaClientSequence,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncLogChange,
  SyncProtocolError,
  type RegisterReplicaRequest,
  type RegisterReplicaResult,
  type SyncCommandEnvelope,
  type SyncPullRequest,
  type SyncPullResult,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  commandReceipts,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  replicas,
} from "@store/db/postgres/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InventoryDatabaseError } from "./errors";
import { issueInvoice } from "./issue-invoice";
import type { InventoryActor } from "./model";
import {
  databaseError,
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  isProtocolError,
  lockOrganization,
  protocol,
  requireReady,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

const CommandResult = Schema.Union([AcceptedInvoiceResult, RejectedCommandResult]);
const EMPTY_SYNC_LOG_CHANGES: ReadonlyArray<SyncLogChange> = [];
const encodeChangeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeCommandResultJson = Schema.encodeSync(Schema.fromJsonString(CommandResult));

const decodeStoredJson = <S extends Schema.Top>(schema: S, value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(value).pipe(
    Effect.mapError(databaseError),
  );

const decodeReceipt = (row: typeof commandReceipts.$inferSelect) =>
  Effect.gen(function* () {
    const result = yield* decodeStoredJson(CommandResult, row.resultJson);
    return yield* Schema.decodeUnknownEffect(CommandReceipt)({
      operationId: row.operationId,
      replicaId: row.replicaId,
      clientSequence: integerTextFromNumeric(row.clientSequence),
      payloadHash: row.payloadHash,
      decision: row.decision,
      commitSequence: integerTextFromNumeric(row.commitSequence),
      result,
    }).pipe(Effect.mapError(databaseError));
  });

const recordDecision = Effect.fn("InventoryCommands.recordDecision")(function* (
  tx: InventoryTransaction,
  input: {
    readonly actor: InventoryActor;
    readonly envelope: SyncCommandEnvelope;
    readonly stateCommitSequence: string;
    readonly epoch: string;
    readonly decision: "accepted" | "rejected";
    readonly result: AcceptedInvoiceResult | RejectedCommandResult;
    readonly changes: ReadonlyArray<SyncLogChange>;
    readonly receivedAt: number;
  },
) {
  const commitSequence = incrementDecimalSequence(input.stateCommitSequence);
  yield* tx
    .update(inventoryState)
    .set({ commitSequence })
    .where(eq(inventoryState.organizationId, input.actor.organizationId));
  yield* tx.insert(inventoryTransactions).values({
    organizationId: input.actor.organizationId,
    commitSequence,
    operationId: input.envelope.operationId,
    decision: input.decision,
    epoch: input.epoch,
  });
  for (const [ordinal, change] of input.changes.entries()) {
    yield* tx.insert(inventoryChanges).values({
      organizationId: input.actor.organizationId,
      commitSequence,
      ordinal,
      entity: change.entity,
      action: change.action,
      entityId: change.entityId,
      rowVersion: change.rowVersion,
      rowJson: encodeChangeRowJson(change.row),
    });
  }
  yield* tx.insert(commandReceipts).values({
    organizationId: input.actor.organizationId,
    operationId: input.envelope.operationId,
    replicaId: input.envelope.replicaId,
    clientSequence: input.envelope.clientSequence,
    payloadHash: input.envelope.payloadHash,
    decision: input.decision,
    commitSequence,
    resultJson: encodeCommandResultJson(input.result),
    receivedAt: input.receivedAt,
    attempts: 1,
  });
  yield* tx
    .update(replicas)
    .set({
      lastClientSequence: input.envelope.clientSequence,
      lastSeenAt: input.receivedAt,
    })
    .where(
      and(
        eq(replicas.organizationId, input.actor.organizationId),
        eq(replicas.replicaId, input.envelope.replicaId),
      ),
    );
  return yield* Schema.decodeUnknownEffect(CommandReceipt)({
    operationId: input.envelope.operationId,
    replicaId: input.envelope.replicaId,
    clientSequence: input.envelope.clientSequence,
    payloadHash: input.envelope.payloadHash,
    decision: input.decision,
    commitSequence,
    result: input.result,
  }).pipe(Effect.mapError(databaseError));
});

const commitInTransaction = Effect.fn("InventoryCommands.commitInTransaction")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  envelope: SyncCommandEnvelope,
  receivedAt: number,
) {
  const state = yield* lockOrganization(tx, actor.organizationId);
  if (state.epoch !== envelope.epoch) {
    return yield* protocol("EPOCH_MISMATCH", "The replica epoch does not match.");
  }

  const [existing] = yield* tx
    .select()
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.organizationId, actor.organizationId),
        eq(commandReceipts.operationId, envelope.operationId),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.payloadHash !== envelope.payloadHash) {
      return yield* protocol("OPERATION_ID_REUSED", "The command id was reused.");
    }
    return yield* decodeReceipt(existing);
  }

  const [replica] = yield* tx
    .select()
    .from(replicas)
    .where(
      and(
        eq(replicas.organizationId, actor.organizationId),
        eq(replicas.replicaId, envelope.replicaId),
      ),
    )
    .limit(1);
  if (!replica) {
    return yield* protocol("REPLICA_UNKNOWN", "This replica is not registered.");
  }
  if (replica.ownerUserId !== actor.userId) {
    return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
  }
  const expectedSequence = incrementDecimalSequence(
    integerTextFromNumeric(replica.lastClientSequence),
  );
  if (envelope.clientSequence !== expectedSequence) {
    return yield* protocol(
      "REPLICA_SEQUENCE_GAP",
      `Expected client sequence ${expectedSequence}, received ${envelope.clientSequence}.`,
    );
  }

  if (envelope.command._tag !== "issueInvoice") {
    return yield* protocol("INVALID_OPERATION", "Only issueInvoice is implemented.");
  }
  if (envelope.command.payload.commandId !== envelope.operationId) {
    return yield* protocol(
      "COMMAND_IDENTITY_MISMATCH",
      "The invoice command id must match the envelope operation id.",
    );
  }

  const issued = yield* issueInvoice(tx, actor, envelope.command.payload).pipe(
    Effect.map((accepted) => ({ decision: "accepted" as const, ...accepted })),
    Effect.catch((cause) => {
      if (isProtocolError(cause) && cause.code === "INSUFFICIENT_STOCK") {
        const result: RejectedCommandResult = {
          _tag: "rejected",
          code: cause.code,
          message: cause.message,
        };
        return Effect.succeed({
          decision: "rejected" as const,
          result,
          changes: EMPTY_SYNC_LOG_CHANGES,
        });
      }
      return Effect.fail(cause);
    }),
  );

  return yield* recordDecision(tx, {
    actor,
    envelope,
    stateCommitSequence: integerTextFromNumeric(state.commitSequence),
    epoch: state.epoch,
    decision: issued.decision,
    result: issued.result,
    changes: issued.changes,
    receivedAt,
  });
});

const pullInTransaction = Effect.fn("InventoryCommands.pullInTransaction")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  request: SyncPullRequest,
) {
  const [state] = yield* tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, actor.organizationId))
    .limit(1);
  yield* requireReady(state);
  if (!state) return yield* protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");
  if (state.epoch !== request.epoch) {
    return yield* protocol("EPOCH_MISMATCH", "The replica epoch does not match.");
  }
  const horizon = integerTextFromNumeric(state.commitSequence);
  const retentionFloor = integerTextFromNumeric(state.retentionFloor);
  if (compareDecimalSequence(request.afterCommitSequence, horizon) > 0) {
    return yield* protocol(
      "SNAPSHOT_REQUIRED",
      "This replica is ahead of the authority and needs recovery.",
    );
  }
  if (compareDecimalSequence(request.afterCommitSequence, retentionFloor) < 0) {
    return yield* protocol(
      "SNAPSHOT_REQUIRED",
      "This replica is behind the retained history and needs a snapshot.",
    );
  }
  const limit = request.limit ?? MAX_SYNC_PULL_TRANSACTIONS;
  const headers = yield* tx
    .select()
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, actor.organizationId),
        eq(inventoryTransactions.epoch, request.epoch),
        gt(inventoryTransactions.commitSequence, request.afterCommitSequence),
      ),
    )
    .orderBy(asc(inventoryTransactions.commitSequence))
    .limit(limit);
  const transactions = [];
  for (const header of headers) {
    const rows = yield* tx
      .select()
      .from(inventoryChanges)
      .where(
        and(
          eq(inventoryChanges.organizationId, actor.organizationId),
          eq(inventoryChanges.commitSequence, header.commitSequence),
        ),
      )
      .orderBy(asc(inventoryChanges.ordinal));
    const changes: SyncLogChange[] = [];
    for (const row of rows) {
      const parsed = yield* decodeStoredJson(Schema.Unknown, row.rowJson);
      changes.push(
        yield* Schema.decodeUnknownEffect(SyncLogChange)({
          entity: row.entity,
          action: row.action,
          entityId: row.entityId,
          rowVersion: row.rowVersion,
          row: parsed,
        }).pipe(Effect.mapError(databaseError)),
      );
    }
    transactions.push({
      commitSequence: OrgCommitSequence.make(integerTextFromNumeric(header.commitSequence)),
      operationId: header.operationId,
      decision: header.decision,
      changes,
    });
  }
  const last = transactions.at(-1);
  return {
    epoch: SyncEpoch.make(state.epoch),
    incarnation: AuthorityIncarnation.make(state.incarnation),
    subscription: request.subscription,
    schemaVersion: SYNC_SCHEMA_VERSION,
    transactions,
    nextCommitSequence: last?.commitSequence ?? request.afterCommitSequence,
    horizon: OrgCommitSequence.make(horizon),
    retentionFloor: OrgCommitSequence.make(retentionFloor),
  } satisfies SyncPullResult;
});

const readReceipt = Effect.fn("InventoryCommands.readReceipt")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  operationId: string,
) {
  const [state] = yield* tx
    .select({
      status: inventoryState.status,
      releaseId: inventoryState.releaseId,
    })
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, actor.organizationId))
    .limit(1);
  yield* requireReady(state);
  const [row] = yield* tx
    .select()
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.organizationId, actor.organizationId),
        eq(commandReceipts.operationId, operationId),
      ),
    )
    .limit(1);
  return row ? yield* decodeReceipt(row) : undefined;
});

const registerReplica = Effect.fn("InventoryCommands.registerReplica")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  request: RegisterReplicaRequest,
  now: number,
) {
  const state = yield* lockOrganization(tx, actor.organizationId);
  const [existing] = yield* tx
    .select()
    .from(replicas)
    .where(
      and(
        eq(replicas.organizationId, actor.organizationId),
        eq(replicas.replicaId, request.replicaId),
      ),
    )
    .limit(1);
  const ready = {
    epoch: SyncEpoch.make(state.epoch),
    incarnation: AuthorityIncarnation.make(state.incarnation),
    retentionFloor: OrgCommitSequence.make(integerTextFromNumeric(state.retentionFloor)),
    horizon: OrgCommitSequence.make(integerTextFromNumeric(state.commitSequence)),
    schemaVersion: SYNC_SCHEMA_VERSION,
  };
  if (existing) {
    if (existing.ownerUserId !== actor.userId) {
      return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }
    yield* tx
      .update(replicas)
      .set(
        request.deviceLabel === undefined
          ? { lastSeenAt: now }
          : { lastSeenAt: now, deviceLabel: request.deviceLabel },
      )
      .where(
        and(
          eq(replicas.organizationId, actor.organizationId),
          eq(replicas.replicaId, request.replicaId),
        ),
      );
    return {
      replicaId: existing.replicaId,
      nextClientSequence: ReplicaClientSequence.make(
        incrementDecimalSequence(integerTextFromNumeric(existing.lastClientSequence)),
      ),
      ...ready,
    } satisfies RegisterReplicaResult;
  }
  yield* tx.insert(replicas).values({
    organizationId: actor.organizationId,
    replicaId: request.replicaId,
    ownerUserId: actor.userId,
    deviceLabel: request.deviceLabel ?? null,
    lastClientSequence: "0",
    processedThroughClientSequence: "0",
    registeredAt: now,
    lastSeenAt: now,
  });
  return {
    replicaId: request.replicaId,
    nextClientSequence: ReplicaClientSequence.make("1"),
    ...ready,
  } satisfies RegisterReplicaResult;
});

export type InventoryCommandsError = SyncProtocolError | InventoryDatabaseError;

export interface InventoryCommandsContract {
  readonly register: (
    actor: InventoryActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, InventoryCommandsError>;
  readonly commit: (
    actor: InventoryActor,
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, InventoryCommandsError>;
  readonly receipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, InventoryCommandsError>;
  readonly pull: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, InventoryCommandsError>;
}

/**
 * PostgreSQL owner for inventory command submission and log pull.
 *
 * One `READ COMMITTED` transaction locks the organization's `inventory_state`
 * row, then writes the business change, receipt, and log together. Callers
 * retry the same operation id after an uncertain commit.
 */
export class InventoryCommands extends Context.Service<
  InventoryCommands,
  InventoryCommandsContract
>()("@store/server/InventoryCommands") {}

export const makeInventoryCommands = (db: InventoryDrizzle): InventoryCommandsContract => {
  const transact = runTransaction(db);
  return InventoryCommands.of({
    register: Effect.fn("InventoryCommands.register")(function* (actor, request) {
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        registerReplica(tx, actor, request, receivedAt),
      );
    }),
    commit: Effect.fn("InventoryCommands.commit")(function* (actor, envelope) {
      if (envelope.organizationId !== actor.organizationId) {
        return yield* protocol(
          "ORGANIZATION_MISMATCH",
          "The command does not belong to the active organization.",
        );
      }
      if (envelope.payloadHash !== canonicalPayloadHash(envelope.command)) {
        return yield* protocol("INVALID_PAYLOAD_HASH", "The payload hash does not match.");
      }
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        commitInTransaction(tx, actor, envelope, receivedAt),
      );
    }),
    receipt: Effect.fn("InventoryCommands.receipt")(function* (actor, operationId) {
      return yield* transact("repeatable read", "read only", (tx) =>
        readReceipt(tx, actor, operationId),
      );
    }),
    pull: Effect.fn("InventoryCommands.pull")(function* (actor, request) {
      return yield* transact("repeatable read", "read only", (tx) =>
        pullInTransaction(tx, actor, request),
      );
    }),
  });
};

export const InventoryCommandsUnavailable = Layer.succeed(
  InventoryCommands,
  InventoryCommands.of({
    register: () => Effect.fail(inventoryPostgresUnavailable),
    commit: () => Effect.fail(inventoryPostgresUnavailable),
    receipt: () => Effect.fail(inventoryPostgresUnavailable),
    pull: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
