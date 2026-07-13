import * as Schema from "effect/Schema";

export class SyncDatabaseError extends Schema.TaggedErrorClass<SyncDatabaseError>()(
  "SyncDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export class SyncProtocolError extends Schema.TaggedErrorClass<SyncProtocolError>()(
  "SyncProtocolError",
  { code: Schema.String, message: Schema.String },
) {}

export const protocolError = (code: string, message: string) =>
  SyncProtocolError.make({ code, message });
