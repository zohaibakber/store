import {
  AcceptedCatalogWriteResult,
  AcceptedInvoiceResult,
  AuthorityIncarnation,
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OrgCommitSequence,
  RejectedCommandResult,
  ReplicaClientSequence,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncLogChange,
  type RegisterReplicaRequest,
  type RegisterReplicaResult,
  type SyncCommand,
  type SyncCommandEnvelope,
  type SyncProtocolCode,
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
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { applyCatalogWrite } from "./catalog-write";
import { partitionDigestFromPostgres } from "./digest";
import type { InventoryError } from "./errors";
import { issueInvoice } from "./issue-invoice";
import type { InventoryActor } from "./model";
import {
  databaseError,
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  isProtocolError,
  lockOrganization,
  protocol,
  randomHex,
  readReadyState,
  readReplica,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

const CommandResult = Schema.Union([
  AcceptedInvoiceResult,
  AcceptedCatalogWriteResult,
  RejectedCommandResult,
]);

const REQUEST_FAILURE_CODES: ReadonlyArray<SyncProtocolCode> = [
  "ORGANIZATION_MISMATCH",
  "INVALID_PAYLOAD_HASH",
  "OPERATION_ID_REUSED",
  "REPLICA_SEQUENCE_GAP",
  "EPOCH_MISMATCH",
  "REPLICA_UNKNOWN",
  "REPLICA_OWNED_BY_OTHER",
];

const isDomainRejection = (code: SyncProtocolCode): boolean =>
  !REQUEST_FAILURE_CODES.includes(code);

const PULL_ENVELOPE_HEADROOM_BYTES = 16_384;

export const PULL_PAYLOAD_BUDGET_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES - PULL_ENVELOPE_HEADROOM_BYTES;

const CHANGE_FRAME_OVERHEAD_BYTES = 96;

const GROUP_FRAME_OVERHEAD_BYTES = 128;

const utf8 = new TextEncoder();

const encodedByteLength = (value: string): number => utf8.encode(value).length;
const EMPTY_SYNC_LOG_CHANGES: ReadonlyArray<SyncLogChange> = [];

const rejectedDecision = (code: SyncProtocolCode, message: string) => {
  const result: RejectedCommandResult = { _tag: "rejected", code, message };
  return { decision: "rejected" as const, result, changes: EMPTY_SYNC_LOG_CHANGES };
};

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

const readReceiptRow = Effect.fn("InventoryCommands.readReceiptRow")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  operationId: string,
) {
  const [row] = yield* tx
    .select()
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.organizationId, organizationId),
        eq(commandReceipts.operationId, operationId),
      ),
    )
    .limit(1);
  return row;
});

const recordDecision = Effect.fn("InventoryCommands.recordDecision")(function* (
  tx: InventoryTransaction,
  input: {
    readonly actor: InventoryActor;
    readonly envelope: SyncCommandEnvelope;
    readonly stateCommitSequence: string;
    readonly epoch: string;
    readonly decision: "accepted" | "rejected";
    readonly result: AcceptedInvoiceResult | AcceptedCatalogWriteResult | RejectedCommandResult;
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

const executeCommand = Effect.fn("InventoryCommands.executeCommand")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: SyncCommand,
) {
  if (command._tag === "issueInvoice") {
    return yield* issueInvoice(tx, actor, command.payload);
  }
  return yield* applyCatalogWrite(tx, actor, command.payload);
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

  const existing = yield* readReceiptRow(tx, actor.organizationId, envelope.operationId);
  if (existing) {
    if (existing.payloadHash !== envelope.payloadHash) {
      return yield* protocol("OPERATION_ID_REUSED", "The command id was reused.");
    }
    return yield* decodeReceipt(existing);
  }

  const replica = yield* readReplica(tx, actor.organizationId, envelope.replicaId);
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

  const issued =
    envelope.command.payload.commandId === envelope.operationId
      ? yield* tx
          .transaction((savepoint) => executeCommand(savepoint, actor, envelope.command))
          .pipe(
            Effect.map((accepted) => ({ decision: "accepted" as const, ...accepted })),
            Effect.catch((cause) =>
              isProtocolError(cause) && isDomainRejection(cause.code)
                ? Effect.succeed(rejectedDecision(cause.code, cause.message))
                : Effect.fail(cause),
            ),
          )
      : rejectedDecision(
          "COMMAND_IDENTITY_MISMATCH",
          "The command id must match the envelope operation id.",
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
  const state = yield* readReadyState(tx, actor.organizationId);
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
  let usedBytes = 0;
  const changeRows =
    headers.length === 0
      ? []
      : yield* tx
          .select()
          .from(inventoryChanges)
          .where(
            and(
              eq(inventoryChanges.organizationId, actor.organizationId),
              inArray(
                inventoryChanges.commitSequence,
                headers.map((header) => header.commitSequence),
              ),
            ),
          )
          .orderBy(asc(inventoryChanges.commitSequence), asc(inventoryChanges.ordinal));
  const rowsByCommit = Arr.groupBy(changeRows, (row) => row.commitSequence);
  for (const header of headers) {
    const rows = rowsByCommit[header.commitSequence] ?? [];
    const groupBytes = rows.reduce(
      (total, row) =>
        total +
        CHANGE_FRAME_OVERHEAD_BYTES +
        encodedByteLength(row.rowJson) +
        encodedByteLength(row.entityId) +
        encodedByteLength(row.entity),
      GROUP_FRAME_OVERHEAD_BYTES + encodedByteLength(header.operationId),
    );
    if (transactions.length > 0 && usedBytes + groupBytes > PULL_PAYLOAD_BUDGET_BYTES) break;
    usedBytes += groupBytes;
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
  const nextCommitSequence = last?.commitSequence ?? request.afterCommitSequence;
  const page = {
    epoch: SyncEpoch.make(state.epoch),
    incarnation: AuthorityIncarnation.make(state.incarnation),
    subscription: request.subscription,
    schemaVersion: SYNC_SCHEMA_VERSION,
    transactions,
    nextCommitSequence,
    horizon: OrgCommitSequence.make(horizon),
    retentionFloor: OrgCommitSequence.make(retentionFloor),
  } satisfies SyncPullResult;
  if (request.includeDigest !== true) return page;
  if (compareDecimalSequence(nextCommitSequence, horizon) < 0) return page;
  const digest = yield* partitionDigestFromPostgres(tx, actor.organizationId, request.subscription);
  return { ...page, digest } satisfies SyncPullResult;
});

const readReceipt = Effect.fn("InventoryCommands.readReceipt")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  operationId: string,
) {
  yield* readReadyState(tx, actor.organizationId);
  const row = yield* readReceiptRow(tx, actor.organizationId, operationId);
  return row ? yield* decodeReceipt(row) : undefined;
});

const PROVISIONED_DATASET = "provisioned";

const provisionOrganization = (tx: InventoryTransaction, organizationId: string) =>
  tx
    .insert(inventoryState)
    .values({
      organizationId,
      status: "ready",
      importId: PROVISIONED_DATASET,
      releaseId: PROVISIONED_DATASET,
      incarnation: randomHex(16),
      epoch: "1",
      commitSequence: "0",
      retentionFloor: "0",
    })
    .onConflictDoNothing({ target: inventoryState.organizationId });

const registerReplica = Effect.fn("InventoryCommands.registerReplica")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  request: RegisterReplicaRequest,
  now: number,
) {
  yield* provisionOrganization(tx, actor.organizationId);
  const state = yield* lockOrganization(tx, actor.organizationId);
  const existing = yield* readReplica(tx, actor.organizationId, request.replicaId);
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

export interface InventoryCommandsContract {
  readonly register: (
    actor: InventoryActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, InventoryError>;
  readonly commit: (
    actor: InventoryActor,
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, InventoryError>;
  readonly receipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, InventoryError>;
  readonly pull: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, InventoryError>;
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
