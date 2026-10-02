import {
  CommandReceipt,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  MIN_PULL_BYTE_BUDGET,
  RegisterReplicaRequest,
  RegisterReplicaResult,
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
  randomHex,
  requireState,
  runStatement,
  withSerializationRetry,
  type InventoryDrizzle,
} from "./postgres";
import {
  actorJson,
  answered,
  syncFunctionJson,
  syncFunctionReply,
  syncFunctionRow,
} from "./sync-function";

const PULL_ENVELOPE_HEADROOM_BYTES = 16_384;

const PULL_PAYLOAD_BUDGET_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES - PULL_ENVELOPE_HEADROOM_BYTES;

const clampPullByteBudget = Number.clamp({
  minimum: MIN_PULL_BYTE_BUDGET,
  maximum: PULL_PAYLOAD_BUDGET_BYTES,
});

const pullByteBudget = (maxBytes: number | undefined): number =>
  maxBytes === undefined ? PULL_PAYLOAD_BUDGET_BYTES : clampPullByteBudget(maxBytes);

const submittedRow = syncFunctionRow(
  Schema.Struct({
    guard: Schema.NullOr(Schema.Literal("MALFORMED")),
    origin_replica_id: Schema.NullOr(Schema.String),
    fanout_epoch: Schema.NullOr(Schema.String),
    fanout_horizon: Schema.NullOr(Schema.String),
    fanout_group: Schema.NullOr(Schema.String),
    fanout_bytes: Schema.NullOr(Schema.Number),
    ...syncFunctionReply,
  }),
);

const ReceiptRows = Schema.Array(
  Schema.Struct({ receipt: Schema.NullOr(Schema.fromJsonString(CommandReceipt)) }),
);

const decodeReceiptRows = Schema.decodeUnknownEffect(ReceiptRows);
const decodeRegisterResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RegisterReplicaResult),
);
const encodeRegisterRequest = Schema.encodeSync(Schema.fromJsonString(RegisterReplicaRequest));

export class SyncRequestMalformed extends Schema.TaggedError<SyncRequestMalformed>()(
  "SyncRequestMalformed",
  { message: Schema.String },
) {}

const malformedRequest = SyncRequestMalformed.make({
  message: "The command envelope is not valid JSON of the expected shape.",
});

export const MAX_SUBMIT_BODY_BYTES = 2 * 1024 * 1024;

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
    const json = yield* syncFunctionJson(
      db.execute(
        sql`select "body", "error_code", "error_message" from sync.pull(
          ${actor.organizationId}::text,
          ${request.epoch}::text,
          ${request.subscription}::text,
          ${request.afterCommitSequence}::text,
          ${MAX_SYNC_PULL_TRANSACTIONS}::integer,
          ${pullByteBudget(request.maxBytes)}::integer,
          ${request.digestVersion ?? null}::integer
        )`,
        "objects",
      ),
    );
    return { json } satisfies EncodedJsonBody;
  });

  const submitRaw = Effect.fn("InventoryCommands.submitRaw")(function* (
    actor: InventoryActor,
    bodyText: string,
  ) {
    const receivedAt = yield* Clock.currentTimeMillis;
    const row = yield* submittedRow(
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
    );
    if (row.guard === "MALFORMED") return yield* malformedRequest;
    const { body } = yield* answered(row);
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
      const body = yield* syncFunctionJson(
        withSerializationRetry(
          db.execute(
            sql`select "body", "error_code", "error_message" from sync.register_replica(
              ${actorJson(actor)}::jsonb,
              ${encodeRegisterRequest(request)}::jsonb,
              ${now}::bigint,
              ${randomHex(16)}::text
            )`,
            "objects",
          ),
        ),
      );
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
      ).pipe(Effect.flatMap((found) => Effect.mapError(decodeReceiptRows(found), databaseError)));
      const row = yield* requireState(rows[0]);
      return row.receipt ?? undefined;
    }),
    pullEncoded,
  });
};
