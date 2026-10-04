import { CatalogRefusal } from "../catalog/refusal";
export { CatalogRefusal, CatalogRefusalReason } from "../catalog/refusal";
import * as Schema from "effect/Schema";

import { SyncProtocolError } from "../sync/protocol";

export class ReplicaStorageError extends Schema.TaggedError<ReplicaStorageError>()(
  "ReplicaStorageError",
  {
    message: Schema.String,
    full: Schema.optionalKey(Schema.Boolean),
  },
) {}

export const ReplicaUnavailableReason = Schema.Literals([
  "opening",
  "corrupt",
  "tooNew",
  "busy",
  "closed",
  "restarting",
  "exhausted",
]);
export type ReplicaUnavailableReason = typeof ReplicaUnavailableReason.Type;

export class ReplicaUnavailable extends Schema.TaggedError<ReplicaUnavailable>()(
  "ReplicaUnavailable",
  { reason: ReplicaUnavailableReason },
) {}

export const ReadFailure = Schema.Union([ReplicaStorageError, ReplicaUnavailable]);
export type ReadFailure = typeof ReadFailure.Type;

export const CommandFailure = Schema.Union([
  ReplicaStorageError,
  ReplicaUnavailable,
  CatalogRefusal,
  SyncProtocolError,
]);
export type CommandFailure = typeof CommandFailure.Type;
