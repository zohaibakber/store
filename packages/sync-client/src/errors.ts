import * as Schema from "effect/Schema";

export class SyncTransportError extends Schema.TaggedError<SyncTransportError>()(
  "SyncTransportError",
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    status: Schema.optionalKey(Schema.Number),
    code: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
