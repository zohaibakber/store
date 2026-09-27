import { CommandStatus } from "@store/contracts";
import * as Schema from "effect/Schema";

export const SqliteCell = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Null,
  Schema.instanceOf(Uint8Array),
]);
export type SqliteCell = typeof SqliteCell.Type;

export const SqliteResultRow = Schema.Record(Schema.String, SqliteCell);
export type SqliteResultRow = typeof SqliteResultRow.Type;

export const ReplicaStampRow = Schema.Struct({
  generation: Schema.Number,
  version: Schema.Number,
});
export type ReplicaStampRow = typeof ReplicaStampRow.Type;

export const OutboxCommandStatus = CommandStatus;
export type OutboxCommandStatus = CommandStatus;

export const OutboxStatusRow = Schema.Struct({
  status: OutboxCommandStatus,
});
export type OutboxStatusRow = typeof OutboxStatusRow.Type;

export const ComparisonScalar = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.instanceOf(Uint8Array),
]);
export type ComparisonScalar = typeof ComparisonScalar.Type;

export const ComparisonList = Schema.Array(ComparisonScalar);
export type ComparisonList = typeof ComparisonList.Type;

export const decodeSqliteResultRow = Schema.decodeUnknownSync(SqliteResultRow);
export const decodeReplicaStampRow = Schema.decodeUnknownSync(ReplicaStampRow);
export const decodeOutboxStatusRow = Schema.decodeUnknownOption(OutboxStatusRow);
