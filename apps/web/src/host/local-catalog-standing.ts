import * as Schema from "effect/Schema";

export const LocalCatalogReport = Schema.Union([
  Schema.TaggedStruct("empty", {}),
  Schema.TaggedStruct("stocked", {}),
  Schema.TaggedStruct("unknown", {}),
]);
export type LocalCatalogReport = typeof LocalCatalogReport.Type;
