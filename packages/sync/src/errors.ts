import * as Schema from "effect/Schema";

export class CatalogError extends Schema.TaggedError<CatalogError>()("CatalogError", {
  message: Schema.String,
  reason: Schema.Literals(["transport", "transient", "unauthenticated", "conflict", "rejected"]),
  code: Schema.optionalKey(Schema.String),
  retryAfterMs: Schema.optionalKey(Schema.Number),
}) {}
