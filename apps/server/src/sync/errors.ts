import * as Schema from "effect/Schema";

export class SyncDatabaseError extends Schema.TaggedError<SyncDatabaseError>()(
  "SyncDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

/**
 * Closed set of protocol failures the sync endpoint can report. The HTTP status
 * map is exhaustive against this list, so a new code fails to compile until it
 * gets a status.
 */
export const SyncProtocolCode = Schema.Literals([
  "INVALID_JSON",
  "INVALID_SYNC_REQUEST",
  "INVALID_DEVICE",
  "INVALID_CURSOR",
  "INVALID_OPERATION",
  "INVALID_OCCURRED_AT",
  "INVALID_PAYLOAD_HASH",
  "INVALID_CLIENT_SEQUENCE",
  "INVALID_ENTITY_ID",
  "INVALID_ROW_VERSION",
  "EMPTY_OPERATION",
  "TOO_MANY_OPERATIONS",
  "TOO_MANY_CHANGES",
  "ORGANIZATION_MISMATCH",
  "ACTOR_MISMATCH",
  "DEVICE_MISMATCH",
  "CLIENT_SEQUENCE_REUSED",
  "OPERATION_COLLISION",
  "OPERATION_ID_REUSED",
  "DUPLICATE_OPERATION",
  "IMMUTABLE_ENTITY",
  "IMMUTABLE_ENTITY_REUSED",
  "ENTITY_CONFLICT",
  "ENTITY_RELATION_INVALID",
  "ENTITY_ID_MISMATCH",
  "INVALID_ENTITY_ROW",
  "BATCH_NOT_FOUND",
  "PAYLOAD_HASH_MISMATCH",
  "ENTITY_WRITE_FAILED",
  "CHANGE_LOG_FAILED",
]);
export type SyncProtocolCode = typeof SyncProtocolCode.Type;

export class SyncProtocolError extends Schema.TaggedError<SyncProtocolError>()(
  "SyncProtocolError",
  { code: SyncProtocolCode, message: Schema.String },
) {}

export const protocolError = (code: SyncProtocolCode, message: string) =>
  SyncProtocolError.make({ code, message });
