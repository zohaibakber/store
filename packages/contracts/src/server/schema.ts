import * as Schema from "effect/Schema";

export const MIN_GLOBAL_SEARCH_QUERY_LENGTH = 2;
export const MAX_GLOBAL_SEARCH_QUERY_LENGTH = 80;
export const MAX_GLOBAL_SEARCH_PRODUCTS = 8;

export const GlobalProductSearchInput = Schema.Struct({
  query: Schema.Trim.check(
    Schema.isMinLength(MIN_GLOBAL_SEARCH_QUERY_LENGTH),
    Schema.isMaxLength(MAX_GLOBAL_SEARCH_QUERY_LENGTH),
  ),
});
export interface GlobalProductSearchInput extends Schema.Schema.Type<
  typeof GlobalProductSearchInput
> {}

const nullableText = (description: string, maximumLength: number) =>
  Schema.NullOr(
    Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(maximumLength)),
  ).annotate({ description });

const HttpsUrl = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/), Schema.isMaxLength(2048));

export const GlobalProduct = Schema.Struct({
  name: Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(120)).annotate({
    description: "Product or brand name, without strength or pack size.",
  }),
  composition: nullableText("Active ingredient or composition, without strength.", 160),
  strength: nullableText("Strength including its unit, such as 500mg.", 20),
  unitsPerPack: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10_000)),
  ).annotate({ description: "Units contained in one sealed pack." }),
  manufacturer: nullableText("Manufacturer or brand owner.", 120),
  imageUrl: Schema.NullOr(HttpsUrl).annotate({ description: "Product image on the source site." }),
  sourceUrl: HttpsUrl.annotate({ description: "Web page the product was found on." }),
  sourceName: Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(120)).annotate({
    description: "Hostname of the source page without a leading www.",
  }),
});
export interface GlobalProduct extends Schema.Schema.Type<typeof GlobalProduct> {}

export const GlobalProductSearchResult = Schema.Struct({
  products: Schema.Array(GlobalProduct).check(Schema.isMaxLength(MAX_GLOBAL_SEARCH_PRODUCTS)),
});
export interface GlobalProductSearchResult extends Schema.Schema.Type<
  typeof GlobalProductSearchResult
> {}
