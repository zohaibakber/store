import * as Result from "effect/Result";
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
  "orderHasItems",
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

export const decideField = <S extends Schema.Decoder<unknown>>(
  schema: S,
  value: S["Encoded"],
  refusal: { readonly message?: string; readonly field?: string | undefined },
): Result.Result<S["Type"], CatalogRefusal> =>
  Result.mapError(
    Schema.decodeUnknownResult(schema)(value),
    (error) =>
      new CatalogRefusal({
        reason: "invalidInput",
        message: refusal.message ?? error.message,
        ...(refusal.field === undefined ? null : { field: refusal.field }),
      }),
  );
