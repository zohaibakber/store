import {
  CATALOG_PARTITION_DIGEST_VERSION,
  CommandReceipt,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  MIN_PULL_BYTE_BUDGET,
  RegisterReplicaResult,
  SyncProtocolCode,
  SyncPullResult,
  SyncSubmitCommandResult,
  type RegisterReplicaRequest,
  type SyncCommandEnvelope,
  type SyncPullRequest,
  type SyncSubmitCommandRequest,
} from "@store/contracts";
import { sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Number from "effect/Number";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { EncodedJsonBody, InventoryActor, SubmittedCommand } from "./model";
import {
  databaseError,
  inventoryPostgresUnavailable,
  isDataException,
  protocol,
  randomHex,
  requireReady,
  runStatement,
  withSerializationRetry,
  type InventoryDrizzle,
} from "./postgres";

const PULL_ENVELOPE_HEADROOM_BYTES = 16_384;

export const PULL_PAYLOAD_BUDGET_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES - PULL_ENVELOPE_HEADROOM_BYTES;

const clampPullByteBudget = Number.clamp({
  minimum: MIN_PULL_BYTE_BUDGET,
  maximum: PULL_PAYLOAD_BUDGET_BYTES,
});

export const pullByteBudget = (maxBytes: number | undefined): number =>
  maxBytes === undefined ? PULL_PAYLOAD_BUDGET_BYTES : clampPullByteBudget(maxBytes);

const FunctionFailure = {
  error_code: Schema.NullOr(SyncProtocolCode),
  error_message: Schema.NullOr(Schema.String),
};

const EncodedRows = Schema.Tuple([
  Schema.Struct({ body: Schema.NullOr(Schema.String), ...FunctionFailure }),
]);

const SubmittedRows = Schema.Tuple([
  Schema.Struct({
    guard: Schema.NullOr(Schema.Literal("MALFORMED")),
    origin_replica_id: Schema.NullOr(Schema.String),
    body: Schema.NullOr(Schema.String),
    fanout_epoch: Schema.NullOr(Schema.String),
    fanout_horizon: Schema.NullOr(Schema.String),
    fanout_group: Schema.NullOr(Schema.String),
    fanout_bytes: Schema.NullOr(Schema.Number),
    ...FunctionFailure,
  }),
]);

const ReceiptRows = Schema.Array(
  Schema.Struct({
    status: Schema.String,
    release_id: Schema.NullOr(Schema.String),
    receipt: Schema.NullOr(Schema.fromJsonString(CommandReceipt)),
  }),
);

const decodeEncodedRows = Schema.decodeUnknownEffect(EncodedRows);
const decodeSubmittedRows = Schema.decodeUnknownEffect(SubmittedRows);
const decodeReceiptRows = Schema.decodeUnknownEffect(ReceiptRows);
const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandReceipt));
const decodeRegisterResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RegisterReplicaResult),
);
const decodePullResult = Schema.decodeUnknownEffect(Schema.fromJsonString(SyncPullResult));
const decodeSubmitResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SyncSubmitCommandResult),
);

type FunctionOutcome = {
  readonly body: string | null;
  readonly error_code: SyncProtocolCode | null;
  readonly error_message: string | null;
};

const bodyOrProtocolError = (row: FunctionOutcome) =>
  row.error_code !== null
    ? protocol(row.error_code, row.error_message ?? row.error_code)
    : row.body === null
      ? Effect.fail(databaseError(new Error("The sync function returned no body.")))
      : Effect.succeed(row.body);

const decodedWith =
  <I, A>(decode: (input: I) => Effect.Effect<A, Schema.SchemaError>) =>
  (input: I) =>
    decode(input).pipe(Effect.mapError(databaseError));

export class SyncRequestMalformed extends Schema.TaggedError<SyncRequestMalformed>()(
  "SyncRequestMalformed",
  { message: Schema.String },
) {}

const malformedRequest = SyncRequestMalformed.make({
  message: "The command envelope is not valid JSON of the expected shape.",
});

export const MAX_SUBMIT_BODY_BYTES = 2 * 1024 * 1024;

const actorJson = (actor: InventoryActor) =>
  JSON.stringify({ organizationId: actor.organizationId, userId: actor.userId });

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
  ) => Effect.Effect<SubmittedCommand, InventoryError>;
  readonly submitRaw: (
    actor: InventoryActor,
    bodyText: string,
  ) => Effect.Effect<SubmittedCommand, InventoryError | SyncRequestMalformed>;
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

export class InventoryCommands extends Context.Service<
  InventoryCommands,
  InventoryCommandsContract
>()("@store/server/InventoryCommands") {}

export const makeInventoryCommands = (db: InventoryDrizzle): InventoryCommandsContract => {
  const pullEncoded = Effect.fn("InventoryCommands.pullEncoded")(function* (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) {
    const [row] = yield* runStatement(
      db.execute(
        sql`select "body", "error_code", "error_message" from sync.pull(
          ${actor.organizationId}::text,
          ${request.epoch}::text,
          ${request.subscription}::text,
          ${request.afterCommitSequence}::text,
          ${request.limit ?? MAX_SYNC_PULL_TRANSACTIONS}::integer,
          ${pullByteBudget(request.maxBytes)}::integer,
          ${request.digestVersion !== undefined}::boolean,
          ${request.digestVersion ?? CATALOG_PARTITION_DIGEST_VERSION}::integer
        )`,
        "objects",
      ),
    ).pipe(Effect.flatMap(decodedWith(decodeEncodedRows)));
    return { json: yield* bodyOrProtocolError(row) } satisfies EncodedJsonBody;
  });

  const submitRaw = Effect.fn("InventoryCommands.submitRaw")(function* (
    actor: InventoryActor,
    bodyText: string,
  ) {
    const receivedAt = yield* Clock.currentTimeMillis;
    const [row] = yield* runStatement(
      withSerializationRetry(
        db.execute(
          sql`select "g"."guard", "r"."request"->>'replicaId' as "origin_replica_id",
            "s"."body", "s"."fanout_epoch", "s"."fanout_horizon", "s"."fanout_group",
            "s"."fanout_bytes", "s"."error_code", "s"."error_message"
          from (select ${bodyText}::text::json as "request") as "r"
          cross join lateral (
            select case
              when json_typeof("r"."request") <> 'object' then 'MALFORMED'
            end as "guard"
          ) as "g"
          left join lateral (
            select * from sync.submit_command(
              ${actorJson(actor)}::jsonb,
              "r"."request",
              ${receivedAt}::bigint,
              least(
                greatest(
                  coalesce(("r"."request"->>'maxBytes')::numeric, ${PULL_PAYLOAD_BUDGET_BYTES}::numeric),
                  ${MIN_PULL_BYTE_BUDGET}::numeric
                ),
                ${PULL_PAYLOAD_BUDGET_BYTES}::numeric
              )::integer
            )
            where "g"."guard" is null
          ) as "s" on true`,
          "objects",
        ),
      ),
    ).pipe(
      Effect.catchIf(
        (error) => error._tag === "InventoryDatabaseError" && isDataException(error),
        () => Effect.fail(malformedRequest),
      ),
      Effect.flatMap(decodedWith(decodeSubmittedRows)),
    );
    if (row.guard === "MALFORMED") return yield* malformedRequest;
    const body = yield* bodyOrProtocolError(row);
    const fanout =
      row.fanout_epoch === null ||
      row.fanout_horizon === null ||
      row.fanout_group === null ||
      row.fanout_bytes === null ||
      row.origin_replica_id === null
        ? null
        : {
            epoch: row.fanout_epoch,
            horizon: row.fanout_horizon,
            group: row.fanout_group,
            byteLength: row.fanout_bytes,
            originReplicaId: row.origin_replica_id,
          };
    return { body, fanout } satisfies SubmittedCommand;
  });

  const submitEncoded = Effect.fn("InventoryCommands.submitEncoded")(function* (
    actor: InventoryActor,
    request: SyncSubmitCommandRequest,
  ) {
    return yield* submitRaw(actor, JSON.stringify(request)).pipe(
      Effect.catchTag("SyncRequestMalformed", (error) => Effect.fail(databaseError(error))),
    );
  });

  return InventoryCommands.of({
    register: Effect.fn("InventoryCommands.register")(function* (actor, request) {
      const now = yield* Clock.currentTimeMillis;
      const [row] = yield* runStatement(
        withSerializationRetry(
          db.execute(
            sql`select "body", "error_code", "error_message" from sync.register_replica(
              ${actorJson(actor)}::jsonb,
              ${JSON.stringify(request)}::jsonb,
              ${now}::bigint,
              ${randomHex(16)}::text
            )`,
            "objects",
          ),
        ),
      ).pipe(Effect.flatMap(decodedWith(decodeEncodedRows)));
      const body = yield* bodyOrProtocolError(row);
      return yield* decodeRegisterResult(body).pipe(Effect.mapError(databaseError));
    }),
    commit: Effect.fn("InventoryCommands.commit")(function* (actor, envelope) {
      const submitted = yield* submitEncoded(actor, envelope);
      return yield* decodeReceipt(submitted.body).pipe(Effect.mapError(databaseError));
    }),
    submit: Effect.fn("InventoryCommands.submit")(function* (actor, request) {
      const submitted = yield* submitEncoded(actor, request);
      return yield* decodeSubmitResult(submitted.body).pipe(Effect.mapError(databaseError));
    }),
    submitEncoded,
    submitRaw,
    receipt: Effect.fn("InventoryCommands.receipt")(function* (actor, operationId) {
      const rows = yield* runStatement(
        db.execute(
          sql`select "s"."status", "s"."release_id",
            case when "r"."operation_id" is null then null else sync.receipt_frame("r") end as "receipt"
          from "inventory_state" as "s"
          left join "command_receipts" as "r"
            on "r"."organization_id" = "s"."organization_id"
            and "r"."operation_id" = ${operationId}::text
          where "s"."organization_id" = ${actor.organizationId}::text`,
          "objects",
        ),
      ).pipe(Effect.flatMap(decodedWith(decodeReceiptRows)));
      const row = rows[0];
      yield* requireReady(row === undefined ? undefined : { ...row, releaseId: row.release_id });
      return row?.receipt ?? undefined;
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
    submitRaw: () => Effect.fail(inventoryPostgresUnavailable),
    receipt: () => Effect.fail(inventoryPostgresUnavailable),
    pull: () => Effect.fail(inventoryPostgresUnavailable),
    pullEncoded: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
