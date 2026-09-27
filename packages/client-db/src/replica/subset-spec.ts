import * as Schema from "effect/Schema";

import { INVENTORY_COLLECTION_SOURCES, MAX_IN_VALUES, MAX_LIKE_PATTERN_LENGTH } from "./sources";

export const SubsetScalar = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
export type SubsetScalar = typeof SubsetScalar.Type;

const SubsetColumn = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*$/u));

export const SubsetLeafPredicate = Schema.Union([
  Schema.TaggedStruct("compare", {
    column: SubsetColumn,
    op: Schema.Literals(["eq", "gt", "gte", "lt", "lte"]),
    value: SubsetScalar,
  }),
  Schema.TaggedStruct("in", {
    column: SubsetColumn,
    values: Schema.Array(SubsetScalar).check(Schema.isMaxLength(MAX_IN_VALUES)),
  }),
  Schema.TaggedStruct("isNull", { column: SubsetColumn }),
  Schema.TaggedStruct("like", {
    column: SubsetColumn,
    pattern: Schema.String.check(Schema.isMaxLength(MAX_LIKE_PATTERN_LENGTH)),
  }),
]);
export type SubsetLeafPredicate = typeof SubsetLeafPredicate.Type;

export type SubsetPredicate =
  | SubsetLeafPredicate
  | { readonly _tag: "and"; readonly predicates: ReadonlyArray<SubsetPredicate> }
  | { readonly _tag: "or"; readonly predicates: ReadonlyArray<SubsetPredicate> }
  | { readonly _tag: "not"; readonly predicate: SubsetPredicate };

const NestedPredicate = Schema.suspend((): Schema.Codec<SubsetPredicate> => SubsetPredicate);

export const SubsetPredicate: Schema.Codec<SubsetPredicate> = Schema.Union([
  SubsetLeafPredicate,
  Schema.TaggedStruct("and", { predicates: Schema.Array(NestedPredicate) }),
  Schema.TaggedStruct("or", { predicates: Schema.Array(NestedPredicate) }),
  Schema.TaggedStruct("not", { predicate: NestedPredicate }),
]);

export const InventorySubsetSpec = Schema.Struct({
  source: Schema.Literals(INVENTORY_COLLECTION_SOURCES),
  where: Schema.optionalKey(SubsetPredicate),
  orderBy: Schema.Array(
    Schema.Struct({ column: SubsetColumn, direction: Schema.Literals(["asc", "desc"]) }),
  ),
  limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type InventorySubsetSpec = typeof InventorySubsetSpec.Type;
