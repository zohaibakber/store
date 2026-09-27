import { CommandStatus } from "@store/contracts";
import * as Schema from "effect/Schema";

const SqliteCell = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Null,
  Schema.instanceOf(Uint8Array),
]);

export const SqliteResultRow = Schema.Record(Schema.String, SqliteCell);
export type SqliteResultRow = typeof SqliteResultRow.Type;

const ReplicaStampRow = Schema.Struct({
  generation: Schema.Number,
  version: Schema.Number,
});

export const OutboxCommandStatus = CommandStatus;
export type OutboxCommandStatus = CommandStatus;

const OutboxStatusRow = Schema.Struct({
  status: OutboxCommandStatus,
});

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
