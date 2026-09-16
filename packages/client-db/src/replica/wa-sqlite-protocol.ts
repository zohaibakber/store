import * as Schema from "effect/Schema";

import { SqliteResultRow } from "./sqlite-row";
import type { SqliteParameter } from "./types";

const SqliteWorkerParameter = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Null,
  Schema.BigInt,
  Schema.instanceOf(Uint8Array),
]);

export const ReplicaWorkerRequest = Schema.TaggedUnion({
  open: {
    requestId: Schema.Number,
    databaseName: Schema.String,
  },
  query: {
    requestId: Schema.Number,
    sql: Schema.String,
    parameters: Schema.Array(SqliteWorkerParameter),
  },
  close: {
    requestId: Schema.Number,
  },
});
export type ReplicaWorkerRequest = typeof ReplicaWorkerRequest.Type;

export const ReplicaWorkerResponse = Schema.TaggedUnion({
  rows: {
    requestId: Schema.Number,
    rows: Schema.Array(SqliteResultRow),
  },
  ok: {
    requestId: Schema.Number,
  },
  error: {
    requestId: Schema.Number,
    message: Schema.String,
  },
});
export type ReplicaWorkerResponse = typeof ReplicaWorkerResponse.Type;

export const workerParameters = (
  parameters: ReadonlyArray<SqliteParameter>,
): ReadonlyArray<typeof SqliteWorkerParameter.Type> =>
  parameters.map((parameter) =>
    parameter instanceof Uint8Array ? new Uint8Array(parameter) : parameter,
  );
