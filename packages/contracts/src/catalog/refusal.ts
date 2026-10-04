import * as Schema from "effect/Schema";

export const CatalogRefusalReason = Schema.Literals([
  "invalidInput",
  "categoryHasProducts",
  "productHasStock",
  "unitsPerPackWithStock",
  "batchHasStock",
  "insufficientStock",
  "duplicateName",
  "missingReference",
  "emptyCommand",
  "tooManyLines",
  "staleRow",
  "supplierHasOrders",
  "orderTransitionInvalid",
  "orderNotOpen",
  "orderNotDraft",
  "itemReceived",
  "lineBelongsElsewhere",
  "allocationFailed",
]);
export type CatalogRefusalReason = typeof CatalogRefusalReason.Type;

export class CatalogRefusal extends Schema.TaggedError<CatalogRefusal>()("CatalogRefusal", {
  reason: CatalogRefusalReason,
  message: Schema.String,
  field: Schema.optionalKey(Schema.String),
}) {}
