import * as Schema from "effect/Schema";

export class SyncDatabaseError extends Schema.TaggedErrorClass<SyncDatabaseError>()(
  "SyncDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

/**
 * Every protocol failure the sync endpoint can report. Keeping this closed is
 * what lets the HTTP status mapping be checked for exhaustiveness — an added
 * code fails to compile until it is given a status.
 */
export const SyncProtocolCode = Schema.Literals([
  // Malformed or oversized request
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
  // Identity the caller is not allowed to act for
  "ORGANIZATION_MISMATCH",
  "ACTOR_MISMATCH",
  "DEVICE_MISMATCH",
  // Conflicts with state the server already holds
  "CLIENT_SEQUENCE_REUSED",
  "OPERATION_COLLISION",
  "OPERATION_ID_REUSED",
  "DUPLICATE_OPERATION",
  "IMMUTABLE_ENTITY",
  "IMMUTABLE_ENTITY_REUSED",
  "ENTITY_CONFLICT",
  // Well-formed but not applicable
  "ENTITY_RELATION_INVALID",
  "ENTITY_ID_MISMATCH",
  "INVALID_ENTITY_ROW",
  "BATCH_NOT_FOUND",
  "PAYLOAD_HASH_MISMATCH",
  // Server-side faults
  "ENTITY_WRITE_FAILED",
  "CHANGE_LOG_FAILED",
]);
export type SyncProtocolCode = typeof SyncProtocolCode.Type;

export class SyncProtocolError extends Schema.TaggedErrorClass<SyncProtocolError>()(
  "SyncProtocolError",
  { code: SyncProtocolCode, message: Schema.String },
) {}

export const protocolError = (code: SyncProtocolCode, message: string) =>
  SyncProtocolError.make({ code, message });
