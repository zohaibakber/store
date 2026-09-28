import { CommandReceipt, CommandStatus } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

export const MAX_COMMAND_OUTCOME_IDS = 200;

export const CommandOutcomeIds = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
).check(Schema.isMaxLength(MAX_COMMAND_OUTCOME_IDS));

export const CommandRejection = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});
export type CommandRejection = typeof CommandRejection.Type;

export const CommandOutcome = Schema.Struct({
  operationId: Schema.String,
  status: CommandStatus,
  rejection: Schema.NullOr(CommandRejection),
});
export type CommandOutcome = typeof CommandOutcome.Type;

export const ReplicaSyncProgress = Schema.Struct({
  sessionOpenedAt: Schema.Number,
  caughtUpAt: Schema.NullOr(Schema.Number),
});
export type ReplicaSyncProgress = typeof ReplicaSyncProgress.Type;

const OutcomeRow = Schema.Struct({
  operationId: Schema.String,
  status: CommandStatus,
  receiptJson: Schema.NullOr(Schema.String),
});

const CaughtUpRow = Schema.Struct({ caughtUpAt: Schema.NullOr(Schema.Number) });

const decodeOutcomeRows = Schema.decodeUnknownEffect(Schema.Array(OutcomeRow));
const decodeCaughtUpRow = Schema.decodeUnknownEffect(CaughtUpRow);
const decodeReceipt = Schema.decodeUnknownOption(Schema.fromJsonString(CommandReceipt));

const rejectionOf = (receiptJson: string | null): CommandRejection | null =>
  receiptJson === null
    ? null
    : Option.match(decodeReceipt(receiptJson), {
        onNone: () => null,
        onSome: (receipt) =>
          receipt.result._tag === "rejected"
            ? { code: receipt.result.code, message: receipt.result.message }
            : null,
      });

export const readCommandOutcomesSqlite = Effect.fn("ReplicaCommandOutcome.readCommandOutcomes")(
  function* (sql: SqlClient, operationIds: ReadonlyArray<string>) {
    if (operationIds.length === 0) return [] satisfies ReadonlyArray<CommandOutcome>;
    const rows = yield* sql
      .unsafe(
        `select operationId, status, receiptJson from command_outbox where operationId in (${operationIds
          .map(() => "?")
          .join(", ")})`,
        [...operationIds],
      )
      .pipe(Effect.flatMap(decodeOutcomeRows), Effect.orDie);
    return rows.map((row): CommandOutcome => ({
      operationId: row.operationId,
      status: row.status,
      rejection: row.status === "rejected" ? rejectionOf(row.receiptJson) : null,
    }));
  },
);

export const readCaughtUpAtSqlite = Effect.fn("ReplicaCommandOutcome.readCaughtUpAt")(function* (
  sql: SqlClient,
) {
  const state = yield* sql
    .unsafe(`select caughtUpAt from replica_state where id = 'singleton'`)
    .pipe(
      Effect.flatMap((rows) => decodeCaughtUpRow(rows[0])),
      Effect.orDie,
    );
  return state.caughtUpAt;
});
