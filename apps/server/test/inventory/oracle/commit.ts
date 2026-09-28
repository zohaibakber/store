import {
  CommandReceipt,
  incrementDecimalSequence,
  OrgCommitSequence,
  SyncProtocolError,
  unpadDecimalSequence,
  type AcceptedCatalogWriteResult,
  type AcceptedInvoiceResult,
  type RejectedCommandResult,
  type SyncCommand,
  type SyncCommandEnvelope,
  type SyncLogChange,
  type SyncProtocolCode,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  commandReceipts,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  replicas,
} from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";

import type { InventoryActor } from "../../../src/inventory/model";
import type { InventoryDrizzle } from "../../../src/inventory/postgres";
import { applyCatalogWrite } from "./catalog-write";
import { issueInvoice } from "./issue-invoice";
import { lockOrganization, protocol, readReplica, type InventoryTransaction } from "./postgres";

const CommandResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("issueInvoice"),
    invoiceId: Schema.String,
    invoiceNumber: Schema.Number,
  }),
  Schema.Struct({ _tag: Schema.Literal("catalogWrite"), rowsWritten: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("rejected"), code: Schema.String, message: Schema.String }),
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

const isProtocolError = Schema.is(SyncProtocolError);

const integerText = (value: string) => unpadDecimalSequence(value.split(".", 1)[0] ?? value);

const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeCommandResultJson = Schema.encodeSync(Schema.fromJsonString(CommandResult));
const decodeCommandResultJson = Schema.decodeUnknownSync(Schema.fromJsonString(CommandResult));

const utf8 = new TextEncoder();

export const pullGroupByteLength = (
  operationId: string,
  changes: ReadonlyArray<{
    readonly entity: string;
    readonly entityId: string;
    readonly rowJson: string;
  }>,
): number =>
  changes.reduce(
    (total, change) =>
      total +
      96 +
      utf8.encode(change.rowJson).length +
      utf8.encode(change.entityId).length +
      utf8.encode(change.entity).length,
    128 + utf8.encode(operationId).length,
  );

type Decision = {
  readonly decision: "accepted" | "rejected";
  readonly result: AcceptedInvoiceResult | AcceptedCatalogWriteResult | RejectedCommandResult;
  readonly changes: ReadonlyArray<SyncLogChange>;
};

const rejected = (code: SyncProtocolCode, message: string): Decision => ({
  decision: "rejected",
  result: { _tag: "rejected", code, message },
  changes: [],
});

const sqlStateOf = (cause: unknown): string | undefined => {
  const failure =
    Predicate.isTagged(cause, "EffectDrizzleQueryError") &&
    Predicate.hasProperty(cause, "cause") &&
    Cause.isCause(cause.cause)
      ? Option.getOrUndefined(Cause.findErrorOption(cause.cause))
      : cause;
  if (!SqlError.isSqlError(failure)) return undefined;
  return Option.getOrUndefined(
    Option.map(decodeSqlStateOrigin(failure.reason.cause), (origin) => origin.code),
  );
};

const decodeSqlStateOrigin = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

const OUT_OF_RANGE = rejected("INVALID_OPERATION", "A value in this command is out of range.");

const DOMAIN_SQL_STATE_REJECTIONS = new Map<string, Decision>([
  ["23505", rejected("ENTITY_CONFLICT", "A record this command creates already exists.")],
  ["22003", OUT_OF_RANGE],
  ["22P02", OUT_OF_RANGE],
  ["23514", OUT_OF_RANGE],
]);

const domainRejection = (cause: unknown): Decision | undefined => {
  const state = sqlStateOf(cause);
  return state === undefined ? undefined : DOMAIN_SQL_STATE_REJECTIONS.get(state);
};

const executeCommand = Effect.fn("Oracle.executeCommand")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: SyncCommand,
) {
  if (command._tag === "issueInvoice") {
    return yield* issueInvoice(tx, actor, command.payload);
  }
  return yield* applyCatalogWrite(tx, actor, command.payload);
});

const receiptOf = (row: typeof commandReceipts.$inferSelect) =>
  Schema.decodeUnknownSync(CommandReceipt)({
    operationId: row.operationId,
    replicaId: row.replicaId,
    clientSequence: integerText(row.clientSequence),
    payloadHash: row.payloadHash,
    decision: row.decision,
    commitSequence: integerText(row.commitSequence),
    result: decodeCommandResultJson(row.resultJson),
  });

const commitInTransaction = Effect.fn("Oracle.commitInTransaction")(function* (
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
    return receiptOf(existing);
  }
  const replica = yield* readReplica(tx, actor.organizationId, envelope.replicaId);
  if (!replica) {
    return yield* protocol("REPLICA_UNKNOWN", "This replica is not registered.");
  }
  if (replica.ownerUserId !== actor.userId) {
    return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
  }
  const expectedSequence = incrementDecimalSequence(integerText(replica.lastClientSequence));
  if (envelope.clientSequence !== expectedSequence) {
    return yield* protocol(
      "REPLICA_SEQUENCE_GAP",
      `Expected client sequence ${expectedSequence}, received ${envelope.clientSequence}.`,
    );
  }
  const issued: Decision =
    envelope.command.payload.commandId === envelope.operationId
      ? yield* tx
          .transaction((savepoint) => executeCommand(savepoint, actor, envelope.command))
          .pipe(
            Effect.map((accepted): Decision => ({ decision: "accepted", ...accepted })),
            Effect.catch((cause) => {
              if (isProtocolError(cause) && !REQUEST_FAILURE_CODES.includes(cause.code)) {
                return Effect.succeed(rejected(cause.code, cause.message));
              }
              const domain = domainRejection(cause);
              return domain ? Effect.succeed(domain) : Effect.fail(cause);
            }),
          )
      : rejected(
          "COMMAND_IDENTITY_MISMATCH",
          "The command id must match the envelope operation id.",
        );

  const commitSequence = OrgCommitSequence.make(
    incrementDecimalSequence(integerText(state.commitSequence)),
  );
  const changeRows = issued.changes.map((change, ordinal) => ({
    organizationId: actor.organizationId,
    commitSequence,
    ordinal,
    entity: change.entity,
    action: change.action,
    entityId: change.entityId,
    rowVersion: change.rowVersion,
    rowJson: encodeRowJson(change.row),
  }));
  yield* tx
    .update(inventoryState)
    .set({ commitSequence })
    .where(eq(inventoryState.organizationId, actor.organizationId));
  yield* tx.insert(inventoryTransactions).values({
    organizationId: actor.organizationId,
    commitSequence,
    operationId: envelope.operationId,
    decision: issued.decision,
    epoch: state.epoch,
    byteLength: pullGroupByteLength(envelope.operationId, changeRows),
  });
  if (changeRows.length > 0) {
    yield* tx.insert(inventoryChanges).values(changeRows);
  }
  const [receipt] = yield* tx
    .insert(commandReceipts)
    .values({
      organizationId: actor.organizationId,
      operationId: envelope.operationId,
      replicaId: envelope.replicaId,
      clientSequence: envelope.clientSequence,
      payloadHash: envelope.payloadHash,
      decision: issued.decision,
      commitSequence,
      resultJson: encodeCommandResultJson(issued.result),
      receivedAt,
      attempts: 1,
    })
    .returning();
  yield* tx
    .update(replicas)
    .set({ lastClientSequence: envelope.clientSequence, lastSeenAt: receivedAt })
    .where(
      and(
        eq(replicas.organizationId, actor.organizationId),
        eq(replicas.replicaId, envelope.replicaId),
      ),
    );
  if (!receipt) return yield* Effect.die("The oracle receipt was not written.");
  return receiptOf(receipt);
});

export const commitWithOracle = Effect.fn("Oracle.commit")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  envelope: SyncCommandEnvelope,
  receivedAt: number,
) {
  if (envelope.organizationId !== actor.organizationId) {
    return yield* protocol(
      "ORGANIZATION_MISMATCH",
      "The command does not belong to the active organization.",
    );
  }
  if (envelope.payloadHash !== canonicalPayloadHash(envelope.command)) {
    return yield* protocol("INVALID_PAYLOAD_HASH", "The payload hash does not match.");
  }
  return yield* db.transaction((tx) => commitInTransaction(tx, actor, envelope, receivedAt), {
    isolationLevel: "read committed",
    accessMode: "read write",
  });
});
