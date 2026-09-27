import {
  AcceptedCatalogWriteResult,
  AcceptedInvoiceResult,
  AuthorityIncarnation,
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  MIN_PULL_BYTE_BUDGET,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  RejectedCommandResult,
  ReplicaClientSequence,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncLogChange,
  SyncPullResult,
  SyncSubmitCommandResult,
  type RegisterReplicaRequest,
  type RegisterReplicaResult,
  type SyncCommand,
  type SyncCommandEnvelope,
  type SyncProtocolCode,
  type SyncPullRequest,
  type SyncSubmitCommandRequest,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  commandReceipts,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  replicas,
} from "@store/db/postgres/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Number from "effect/Number";
import * as Schema from "effect/Schema";

import { applyCatalogWrite } from "./catalog-write";
import { partitionDigestFromPostgres } from "./digest";
import type { InventoryError } from "./errors";
import { issueInvoice } from "./issue-invoice";
import type { EncodedJsonBody, InventoryActor } from "./model";
import {
  databaseError,
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  isProtocolError,
  lockOrganization,
  protocol,
  randomHex,
  readReplica,
  requireReady,
  runStatement,
  runTransaction,
  type InventoryDrizzle,
  type InventoryExecutor,
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

const clampPullByteBudget = Number.clamp({
  minimum: MIN_PULL_BYTE_BUDGET,
  maximum: PULL_PAYLOAD_BUDGET_BYTES,
});

/**
 * Byte budget for one pull page. A client on a slow or metered network may
 * ask for less; the server holds every request inside
 * `[MIN_PULL_BYTE_BUDGET, PULL_PAYLOAD_BUDGET_BYTES]`.
 */
export const pullByteBudget = (maxBytes: number | undefined): number =>
  maxBytes === undefined ? PULL_PAYLOAD_BUDGET_BYTES : clampPullByteBudget(maxBytes);

const CHANGE_FRAME_OVERHEAD_BYTES = 96;

const GROUP_FRAME_OVERHEAD_BYTES = 128;

const utf8 = new TextEncoder();

const encodedByteLength = (value: string): number => utf8.encode(value).length;
const EMPTY_SYNC_LOG_CHANGES: ReadonlyArray<SyncLogChange> = [];

type StoredChangeFrame = {
  readonly entity: string;
  readonly entityId: string;
  readonly rowJson: string;
};

/**
 * Pull-frame size of one transaction group, persisted as
 * `inventory_transactions.byte_length` when the group commits. Pull pages are
 * selected by the running sum of this value, so the formula must stay equal to
 * the backfill in the migration that introduced the column.
 */
export const pullGroupByteLength = (
  operationId: string,
  changes: ReadonlyArray<StoredChangeFrame>,
): number =>
  changes.reduce(
    (total, change) =>
      total +
      CHANGE_FRAME_OVERHEAD_BYTES +
      encodedByteLength(change.rowJson) +
      encodedByteLength(change.entityId) +
      encodedByteLength(change.entity),
    GROUP_FRAME_OVERHEAD_BYTES + encodedByteLength(operationId),
  );

const CHANGE_INSERT_BATCH_ROWS = 1_000;

const chunked = <A>(values: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

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

const readReceiptAndReplica = Effect.fn("InventoryCommands.readReceiptAndReplica")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  operationId: string,
  replicaId: string,
) {
  const [row] = yield* tx
    .select({ receipt: commandReceipts, replica: replicas })
    .from(inventoryState)
    .leftJoin(
      commandReceipts,
      and(
        eq(commandReceipts.organizationId, inventoryState.organizationId),
        eq(commandReceipts.operationId, operationId),
      ),
    )
    .leftJoin(
      replicas,
      and(
        eq(replicas.organizationId, inventoryState.organizationId),
        eq(replicas.replicaId, replicaId),
      ),
    )
    .where(eq(inventoryState.organizationId, organizationId))
    .limit(1);
  return { receipt: row?.receipt ?? undefined, replica: row?.replica ?? undefined };
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
  const commitSequence = OrgCommitSequence.make(
    incrementDecimalSequence(input.stateCommitSequence),
  );
  const changeRows = input.changes.map((change, ordinal) => ({
    organizationId: input.actor.organizationId,
    commitSequence,
    ordinal,
    entity: change.entity,
    action: change.action,
    entityId: change.entityId,
    rowVersion: change.rowVersion,
    rowJson: encodeChangeRowJson(change.row),
  }));
  yield* tx
    .update(inventoryState)
    .set({ commitSequence })
    .where(eq(inventoryState.organizationId, input.actor.organizationId));
  const byteLength = pullGroupByteLength(input.envelope.operationId, changeRows);
  yield* tx.insert(inventoryTransactions).values({
    organizationId: input.actor.organizationId,
    commitSequence,
    operationId: input.envelope.operationId,
    decision: input.decision,
    epoch: input.epoch,
    byteLength,
  });
  for (const rows of chunked(changeRows, CHANGE_INSERT_BATCH_ROWS)) {
    yield* tx.insert(inventoryChanges).values([...rows]);
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
  const receipt = yield* Schema.decodeUnknownEffect(CommandReceipt)({
    operationId: input.envelope.operationId,
    replicaId: input.envelope.replicaId,
    clientSequence: input.envelope.clientSequence,
    payloadHash: input.envelope.payloadHash,
    decision: input.decision,
    commitSequence,
    result: input.result,
  }).pipe(Effect.mapError(databaseError));
  return { receipt, commitSequence, changeRows, byteLength };
});

type RecordedDecision = Effect.Success<ReturnType<typeof recordDecision>>;

type LockedState = Effect.Success<ReturnType<typeof lockOrganization>>;

type CommittedCommand = {
  readonly receipt: CommandReceipt;
  readonly page: PulledPage | undefined;
  readonly readPageAfterCommit: boolean;
};

const committedWithoutPage = (
  receipt: CommandReceipt,
  request: SyncSubmitCommandRequest,
): CommittedCommand => ({
  receipt,
  page: undefined,
  readPageAfterCommit: request.afterCommitSequence !== undefined,
});

/**
 * The page a caught-up client would pull next is exactly the group this
 * transaction just wrote, so it is built from memory under the lock with no
 * extra read. A client that is behind reads its page after the commit.
 */
const committedWithPage = (
  request: SyncSubmitCommandRequest,
  state: LockedState,
  recorded: RecordedDecision,
): CommittedCommand => {
  const after = request.afterCommitSequence;
  const horizonBefore = integerTextFromNumeric(state.commitSequence);
  if (after === undefined || compareDecimalSequence(after, horizonBefore) !== 0) {
    return committedWithoutPage(recorded.receipt, request);
  }
  if (recorded.byteLength > pullByteBudget(request.maxBytes)) {
    return { receipt: recorded.receipt, page: undefined, readPageAfterCommit: false };
  }
  const group: PulledGroup = {
    commitSequence: recorded.commitSequence,
    operationId: recorded.receipt.operationId,
    decision: recorded.receipt.decision,
    changes: recorded.changeRows.map((row) =>
      encodeChangeFrame({
        entity: row.entity,
        action: row.action,
        entity_id: row.entityId,
        row_version: row.rowVersion,
        row_json: row.rowJson,
      }),
    ),
  };
  return {
    receipt: recorded.receipt,
    page: {
      envelope: {
        epoch: SyncEpoch.make(state.epoch),
        incarnation: AuthorityIncarnation.make(state.incarnation),
        subscription: OPERATIONAL_SUBSCRIPTION,
        schemaVersion: SYNC_SCHEMA_VERSION,
        nextCommitSequence: recorded.commitSequence,
        horizon: recorded.commitSequence,
        retentionFloor: OrgCommitSequence.make(integerTextFromNumeric(state.retentionFloor)),
      },
      groups: [group],
    },
    readPageAfterCommit: false,
  };
};

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
  envelope: SyncSubmitCommandRequest,
  receivedAt: number,
) {
  const state = yield* lockOrganization(tx, actor.organizationId);
  if (state.epoch !== envelope.epoch) {
    return yield* protocol("EPOCH_MISMATCH", "The replica epoch does not match.");
  }

  const { receipt: existing, replica } = yield* readReceiptAndReplica(
    tx,
    actor.organizationId,
    envelope.operationId,
    envelope.replicaId,
  );
  if (existing) {
    if (existing.payloadHash !== envelope.payloadHash) {
      return yield* protocol("OPERATION_ID_REUSED", "The command id was reused.");
    }
    return committedWithoutPage(yield* decodeReceipt(existing), envelope);
  }

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

  const recorded = yield* recordDecision(tx, {
    actor,
    envelope,
    stateCommitSequence: integerTextFromNumeric(state.commitSequence),
    epoch: state.epoch,
    decision: issued.decision,
    result: issued.result,
    changes: issued.changes,
    receivedAt,
  });
  return committedWithPage(envelope, state, recorded);
});

const PulledRow = Schema.Struct({
  status: Schema.String,
  release_id: Schema.NullOr(Schema.String),
  epoch: Schema.String,
  incarnation: Schema.String,
  horizon: Schema.String,
  retention_floor: Schema.String,
  group_sequence: Schema.NullOr(Schema.String),
  operation_id: Schema.NullOr(Schema.String),
  decision: Schema.NullOr(Schema.Literals(["accepted", "rejected"])),
  entity: Schema.NullOr(Schema.String),
  action: Schema.NullOr(Schema.String),
  entity_id: Schema.NullOr(Schema.String),
  row_version: Schema.NullOr(Schema.Number),
  row_json: Schema.NullOr(Schema.String),
});

const decodePulledRows = Schema.decodeUnknownEffect(Schema.Array(PulledRow));

const pullPageStatement = (
  organizationId: string,
  request: SyncPullRequest,
  limit: number,
  byteBudget: number,
) => sql`
  with "state" as (
    select "status", "release_id", "epoch", "incarnation",
      "commit_sequence" as "horizon_value", "retention_floor" as "floor_value"
    from "inventory_state"
    where "organization_id" = ${organizationId}
  ),
  "candidates" as (
    select "t"."commit_sequence", "t"."operation_id", "t"."decision", "t"."byte_length"
    from "inventory_transactions" as "t"
    where "t"."organization_id" = ${organizationId}
      and "t"."epoch" = ${request.epoch}
      and "t"."commit_sequence" > ${request.afterCommitSequence}::numeric
      and exists (
        select 1 from "state" as "s"
        where "s"."status" = 'ready'
          and "s"."release_id" is not null
          and "s"."epoch" = ${request.epoch}
          and ${request.afterCommitSequence}::numeric between "s"."floor_value" and "s"."horizon_value"
      )
    order by "t"."commit_sequence"
    limit ${limit}
  ),
  "selected" as (
    select "commit_sequence", "operation_id", "decision"
    from (
      select "commit_sequence", "operation_id", "decision",
        sum("byte_length") over (order by "commit_sequence") as "used",
        row_number() over (order by "commit_sequence") as "position"
      from "candidates"
    ) as "sized"
    where "position" = 1 or "used" <= ${byteBudget}
  )
  select "s"."status", "s"."release_id", "s"."epoch", "s"."incarnation",
    "s"."horizon_value"::text as "horizon", "s"."floor_value"::text as "retention_floor",
    "g"."commit_sequence"::text as "group_sequence", "g"."operation_id", "g"."decision",
    "c"."entity", "c"."action", "c"."entity_id", "c"."row_version", "c"."row_json"
  from "state" as "s"
  left join "selected" as "g" on true
  left join "inventory_changes" as "c"
    on "c"."organization_id" = ${organizationId}
    and "c"."commit_sequence" = "g"."commit_sequence"
    and "c"."commit_sequence" > ${request.afterCommitSequence}::numeric
  order by "g"."commit_sequence", "c"."ordinal"
`;

type PulledGroup = {
  readonly commitSequence: OrgCommitSequence;
  readonly operationId: string;
  readonly decision: "accepted" | "rejected";
  readonly changes: Array<string>;
};

type PulledPage = {
  readonly envelope: Omit<SyncPullResult, "transactions" | "digest">;
  readonly groups: ReadonlyArray<PulledGroup>;
};

const jsonString = (value: string | number) => JSON.stringify(value);

const encodeChangeFrame = (row: {
  readonly entity: string;
  readonly action: string;
  readonly entity_id: string;
  readonly row_version: number;
  readonly row_json: string;
}) =>
  `{"entity":${jsonString(row.entity)},"action":${jsonString(row.action)},"entityId":${jsonString(row.entity_id)},"rowVersion":${jsonString(row.row_version)},"row":${row.row_json}}`;

const encodePulledPage = (page: PulledPage, digest: string | undefined): string => {
  const envelope = page.envelope;
  const transactions = page.groups
    .map(
      (group) =>
        `{"commitSequence":${jsonString(group.commitSequence)},"operationId":${jsonString(group.operationId)},"decision":${jsonString(group.decision)},"changes":[${group.changes.join(",")}]}`,
    )
    .join(",");
  const digestField = digest === undefined ? "" : `,"digest":${jsonString(digest)}`;
  return `{"epoch":${jsonString(envelope.epoch)},"incarnation":${jsonString(envelope.incarnation)},"subscription":${jsonString(envelope.subscription)},"schemaVersion":${jsonString(envelope.schemaVersion)},"transactions":[${transactions}],"nextCommitSequence":${jsonString(envelope.nextCommitSequence)},"horizon":${jsonString(envelope.horizon)},"retentionFloor":${jsonString(envelope.retentionFloor)}${digestField}}`;
};

const readPullPage = Effect.fn("InventoryCommands.readPullPage")(function* (
  executor: InventoryExecutor,
  actor: InventoryActor,
  request: SyncPullRequest,
) {
  const limit = request.limit ?? MAX_SYNC_PULL_TRANSACTIONS;
  const raw = yield* runStatement(
    executor.execute(
      pullPageStatement(actor.organizationId, request, limit, pullByteBudget(request.maxBytes)),
      "objects",
    ),
  );
  const rows = yield* decodePulledRows(raw).pipe(Effect.mapError(databaseError));
  const first = rows[0];
  const state = yield* requireReady(
    first === undefined ? undefined : { ...first, releaseId: first.release_id },
  );
  if (state.epoch !== request.epoch) {
    return yield* protocol("EPOCH_MISMATCH", "The replica epoch does not match.");
  }
  const horizon = integerTextFromNumeric(state.horizon);
  const retentionFloor = integerTextFromNumeric(state.retention_floor);
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
  const groups: Array<PulledGroup> = [];
  for (const row of rows) {
    if (row.group_sequence === null || row.operation_id === null || row.decision === null) {
      continue;
    }
    const commitSequence = OrgCommitSequence.make(integerTextFromNumeric(row.group_sequence));
    let group = groups.at(-1);
    if (group === undefined || group.commitSequence !== commitSequence) {
      group = {
        commitSequence,
        operationId: row.operation_id,
        decision: row.decision,
        changes: [],
      };
      groups.push(group);
    }
    if (
      row.entity === null ||
      row.action === null ||
      row.entity_id === null ||
      row.row_version === null ||
      row.row_json === null
    ) {
      continue;
    }
    group.changes.push(
      encodeChangeFrame({
        entity: row.entity,
        action: row.action,
        entity_id: row.entity_id,
        row_version: row.row_version,
        row_json: row.row_json,
      }),
    );
  }
  return {
    envelope: {
      epoch: SyncEpoch.make(state.epoch),
      incarnation: AuthorityIncarnation.make(state.incarnation),
      subscription: request.subscription,
      schemaVersion: SYNC_SCHEMA_VERSION,
      nextCommitSequence: groups.at(-1)?.commitSequence ?? request.afterCommitSequence,
      horizon: OrgCommitSequence.make(horizon),
      retentionFloor: OrgCommitSequence.make(retentionFloor),
    },
    groups,
  } satisfies PulledPage;
});

const pullReachesHorizon = (page: PulledPage) =>
  compareDecimalSequence(page.envelope.nextCommitSequence, page.envelope.horizon) >= 0;

const pullWithDigestInTransaction = Effect.fn("InventoryCommands.pullWithDigestInTransaction")(
  function* (tx: InventoryTransaction, actor: InventoryActor, request: SyncPullRequest) {
    const page = yield* readPullPage(tx, actor, request);
    if (!pullReachesHorizon(page)) return encodePulledPage(page, undefined);
    const digest = yield* partitionDigestFromPostgres(
      tx,
      actor.organizationId,
      request.subscription,
    );
    return encodePulledPage(page, digest);
  },
);

const decodePullResult = Schema.decodeUnknownEffect(Schema.fromJsonString(SyncPullResult));

const encodeReceiptJson = Schema.encodeSync(Schema.fromJsonString(CommandReceipt));

const encodeSubmitResult = (receipt: CommandReceipt, page: PulledPage | undefined): string => {
  const receiptJson = encodeReceiptJson(receipt);
  if (page === undefined) return receiptJson;
  return `${receiptJson.slice(0, -1)},"page":${encodePulledPage(page, undefined)}}`;
};

const decodeSubmitResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SyncSubmitCommandResult),
);

const readReceipt = Effect.fn("InventoryCommands.readReceipt")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  operationId: string,
) {
  const [row] = yield* runStatement(
    db
      .select({
        status: inventoryState.status,
        releaseId: inventoryState.releaseId,
        receipt: commandReceipts,
      })
      .from(inventoryState)
      .leftJoin(
        commandReceipts,
        and(
          eq(commandReceipts.organizationId, inventoryState.organizationId),
          eq(commandReceipts.operationId, operationId),
        ),
      )
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1),
  );
  yield* requireReady(row);
  return row?.receipt ? yield* decodeReceipt(row.receipt) : undefined;
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
  readonly submit: (
    actor: InventoryActor,
    request: SyncSubmitCommandRequest,
  ) => Effect.Effect<SyncSubmitCommandResult, InventoryError>;
  readonly submitEncoded: (
    actor: InventoryActor,
    request: SyncSubmitCommandRequest,
  ) => Effect.Effect<EncodedJsonBody, InventoryError>;
  readonly receipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, InventoryError>;
  readonly pull: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, InventoryError>;
  readonly pullEncoded: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<EncodedJsonBody, InventoryError>;
}

/**
 * PostgreSQL owner for inventory command submission and log pull.
 *
 * One `READ COMMITTED` transaction locks the organization's `inventory_state`
 * row, then writes the business change, receipt, and log together. Callers
 * retry the same operation id after an uncertain commit. A submit that names
 * the client's applied cursor also carries the next pull page; that page is
 * best effort and never fails a committed command.
 */
export class InventoryCommands extends Context.Service<
  InventoryCommands,
  InventoryCommandsContract
>()("@store/server/InventoryCommands") {}

export const makeInventoryCommands = (db: InventoryDrizzle): InventoryCommandsContract => {
  const transact = runTransaction(db);
  const pullEncoded = Effect.fn("InventoryCommands.pullEncoded")(function* (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) {
    const json =
      request.includeDigest === true
        ? yield* transact("repeatable read", "read only", (tx) =>
            pullWithDigestInTransaction(tx, actor, request),
          )
        : encodePulledPage(yield* readPullPage(db, actor, request), undefined);
    return { json } satisfies EncodedJsonBody;
  });
  const commitCommand = Effect.fn("InventoryCommands.commitCommand")(function* (
    actor: InventoryActor,
    request: SyncSubmitCommandRequest,
  ) {
    if (request.organizationId !== actor.organizationId) {
      return yield* protocol(
        "ORGANIZATION_MISMATCH",
        "The command does not belong to the active organization.",
      );
    }
    if (request.payloadHash !== canonicalPayloadHash(request.command)) {
      return yield* protocol("INVALID_PAYLOAD_HASH", "The payload hash does not match.");
    }
    const receivedAt = yield* Clock.currentTimeMillis;
    return yield* transact("read committed", "read write", (tx) =>
      commitInTransaction(tx, actor, request, receivedAt),
    );
  });
  const pageAfterCommit = Effect.fn("InventoryCommands.pageAfterCommit")(function* (
    actor: InventoryActor,
    request: SyncSubmitCommandRequest,
  ) {
    if (request.afterCommitSequence === undefined) return undefined;
    const pull: SyncPullRequest = {
      epoch: request.epoch,
      subscription: OPERATIONAL_SUBSCRIPTION,
      afterCommitSequence: request.afterCommitSequence,
    };
    return yield* readPullPage(
      db,
      actor,
      request.maxBytes === undefined ? pull : { ...pull, maxBytes: request.maxBytes },
    ).pipe(Effect.orElseSucceed(() => undefined));
  });
  const submitEncoded = Effect.fn("InventoryCommands.submitEncoded")(function* (
    actor: InventoryActor,
    request: SyncSubmitCommandRequest,
  ) {
    const committed = yield* commitCommand(actor, request);
    const page = committed.readPageAfterCommit
      ? yield* pageAfterCommit(actor, request)
      : committed.page;
    return { json: encodeSubmitResult(committed.receipt, page) } satisfies EncodedJsonBody;
  });
  return InventoryCommands.of({
    register: Effect.fn("InventoryCommands.register")(function* (actor, request) {
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        registerReplica(tx, actor, request, receivedAt),
      );
    }),
    commit: Effect.fn("InventoryCommands.commit")(function* (actor, envelope) {
      const committed = yield* commitCommand(actor, envelope);
      return committed.receipt;
    }),
    submit: Effect.fn("InventoryCommands.submit")(function* (actor, request) {
      const encoded = yield* submitEncoded(actor, request);
      return yield* decodeSubmitResult(encoded.json).pipe(Effect.mapError(databaseError));
    }),
    submitEncoded,
    receipt: Effect.fn("InventoryCommands.receipt")(function* (actor, operationId) {
      return yield* readReceipt(db, actor, operationId);
    }),
    pull: Effect.fn("InventoryCommands.pull")(function* (actor, request) {
      const encoded = yield* pullEncoded(actor, request);
      return yield* decodePullResult(encoded.json).pipe(Effect.mapError(databaseError));
    }),
    pullEncoded,
  });
};

export const InventoryCommandsUnavailable = Layer.succeed(
  InventoryCommands,
  InventoryCommands.of({
    register: () => Effect.fail(inventoryPostgresUnavailable),
    commit: () => Effect.fail(inventoryPostgresUnavailable),
    submit: () => Effect.fail(inventoryPostgresUnavailable),
    submitEncoded: () => Effect.fail(inventoryPostgresUnavailable),
    receipt: () => Effect.fail(inventoryPostgresUnavailable),
    pull: () => Effect.fail(inventoryPostgresUnavailable),
    pullEncoded: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
