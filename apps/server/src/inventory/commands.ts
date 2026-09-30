import {
  CommandReceipt,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  MIN_PULL_BYTE_BUDGET,
  RegisterReplicaResult,
  SyncProtocolCode,
  type RegisterReplicaRequest,
  type SyncPullRequest,
} from "@store/contracts";
import { commandReceipts, inventoryState } from "@store/db/postgres/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { EncodedJsonBody, InventoryActor, SubmittedCommand } from "./model";
import {
  databaseError,
  isDataException,
  protocol,
  randomHex,
  requireState,
  runStatement,
  withSerializationRetry,
  type InventoryDrizzle,
} from "./postgres";

const PULL_ENVELOPE_HEADROOM_BYTES = 16_384;

const PULL_PAYLOAD_BUDGET_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES - PULL_ENVELOPE_HEADROOM_BYTES;

const clampPullByteBudget = Number.clamp({
  minimum: MIN_PULL_BYTE_BUDGET,
  maximum: PULL_PAYLOAD_BUDGET_BYTES,
});

const pullByteBudget = (maxBytes: number | undefined): number =>
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
  Schema.Struct({ receipt: Schema.NullOr(Schema.fromJsonString(CommandReceipt)) }),
);

const decodeEncodedRows = Schema.decodeUnknownEffect(EncodedRows);
const decodeSubmittedRows = Schema.decodeUnknownEffect(SubmittedRows);
const decodeReceiptRows = Schema.decodeUnknownEffect(ReceiptRows);
const decodeRegisterResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RegisterReplicaResult),
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
  readonly submitRaw: (
    actor: InventoryActor,
    bodyText: string,
  ) => Effect.Effect<SubmittedCommand, InventoryError | SyncRequestMalformed>;
  readonly receipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, InventoryError>;
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
          ${MAX_SYNC_PULL_TRANSACTIONS}::integer,
          ${pullByteBudget(request.maxBytes)}::integer,
          ${request.digestVersion !== undefined}::boolean
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
    submitRaw,
    receipt: Effect.fn("InventoryCommands.receipt")(function* (actor, operationId) {
      const rows = yield* runStatement(
        db
          .select({
            receipt: sql<
              string | null
            >`case when ${commandReceipts.operationId} is null then null else sync.receipt_frame(${commandReceipts}) end`,
          })
          .from(inventoryState)
          .leftJoin(
            commandReceipts,
            and(
              eq(commandReceipts.organizationId, inventoryState.organizationId),
              eq(commandReceipts.operationId, operationId),
            ),
          )
          .where(eq(inventoryState.organizationId, actor.organizationId)),
      ).pipe(Effect.flatMap(decodedWith(decodeReceiptRows)));
      const row = yield* requireState(rows[0]);
      return row.receipt ?? undefined;
    }),
    pullEncoded,
  });
};
