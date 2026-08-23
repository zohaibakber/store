import * as Schema from "effect/Schema";

export class InventoryDatabaseError extends Schema.TaggedError<InventoryDatabaseError>()(
  "InventoryDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export const InventoryProtocolCode = Schema.Literals([
  "INVALID_DEVICE",
  "INVALID_OPERATION",
  "INVALID_OCCURRED_AT",
  "INVALID_PAYLOAD_HASH",
  "INVALID_CLIENT_SEQUENCE",
  "INVALID_ENTITY_ID",
  "EMPTY_OPERATION",
  "TOO_MANY_CHANGES",
  "ORGANIZATION_MISMATCH",
  "ACTOR_MISMATCH",
  "OPERATION_ID_REUSED",
  "DUPLICATE_OPERATION",
  "ENTITY_CONFLICT",
  "ENTITY_RELATION_INVALID",
  "ENTITY_ID_MISMATCH",
  "INVALID_ENTITY_ROW",
  "PAYLOAD_HASH_MISMATCH",
  "ENTITY_WRITE_FAILED",
]);
export type InventoryProtocolCode = typeof InventoryProtocolCode.Type;

export class InventoryProtocolError extends Schema.TaggedError<InventoryProtocolError>()(
  "InventoryProtocolError",
  { code: InventoryProtocolCode, message: Schema.String },
) {}

export const inventoryProtocolError = (code: InventoryProtocolCode, message: string) =>
  InventoryProtocolError.make({ code, message });
