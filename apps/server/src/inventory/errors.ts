import type { SyncProtocolError } from "@store/contracts";
import * as Schema from "effect/Schema";

export class InventoryDatabaseError extends Schema.TaggedError<InventoryDatabaseError>()(
  "InventoryDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export class SyncRequestMalformed extends Schema.TaggedError<SyncRequestMalformed>()(
  "SyncRequestMalformed",
  { message: Schema.String },
) {}

export type InventoryError = SyncProtocolError | InventoryDatabaseError;
