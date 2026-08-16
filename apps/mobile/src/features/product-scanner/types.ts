import * as Schema from "effect/Schema";

export type ProductScanMode = "product" | "batch";

const nullableText = Schema.NullOr(Schema.String.check(Schema.isMinLength(1)));

export const ProductScanResult = Schema.Struct({
  name: nullableText,
  composition: nullableText,
  strength: nullableText,
  unitsPerPack: Schema.NullOr(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(10_000),
    ),
  ),
  batchNumber: nullableText,
  /** A calendar date, normalized to YYYY-MM-DD whenever it can be read. */
  expiresAt: nullableText,
  confidence: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
});
export type ProductScanResult = Schema.Schema.Type<typeof ProductScanResult>;

export type ProductScanInference = ProductScanResult & {
  source: "cloud" | "device";
};
