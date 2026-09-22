import * as Schema from "effect/Schema";

export class InventoryDatabaseError extends Schema.TaggedError<InventoryDatabaseError>()(
  "InventoryDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}
