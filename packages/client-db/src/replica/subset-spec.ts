import * as Schema from "effect/Schema";

import {
  CASE_INSENSITIVE_ORDER_COLUMNS,
  INVENTORY_COLLECTION_SOURCES,
  LIKE_ESCAPE,
  MAX_BATCH_ROWS,
  MAX_BATCH_SPECS,
  MAX_DISTINCT_COLUMNS,
  MAX_IN_VALUES,
  MAX_LIKE_PATTERN_LENGTH,
} from "./sources";

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
    escape: Schema.optionalKey(Schema.Literal(LIKE_ESCAPE)),
  }),
]);
export type SubsetLeafPredicate = typeof SubsetLeafPredicate.Type;

const LIKE_WILDCARDS = new Set(["%", "_", LIKE_ESCAPE]);

const escapedLikeText = (text: string): string => {
  let escaped = "";
  for (const character of text) {
    const next = LIKE_WILDCARDS.has(character) ? `${LIKE_ESCAPE}${character}` : character;
    if (escaped.length + next.length > MAX_LIKE_PATTERN_LENGTH - 2) break;
    escaped += next;
  }
  return escaped;
};

export const containsText = (column: string, text: string): SubsetLeafPredicate => ({
  _tag: "like",
  column,
  pattern: `%${escapedLikeText(text)}%`,
  escape: LIKE_ESCAPE,
});

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

export const SubsetOrderClause = Schema.Struct({
  column: SubsetColumn,
  direction: Schema.Literals(["asc", "desc"]),
  nulls: Schema.optionalKey(Schema.Literals(["first", "last"])),
  collation: Schema.optionalKey(Schema.Literals(["binary", "nocase"])),
});
export type SubsetOrderClause = typeof SubsetOrderClause.Type;

export const InventorySubsetSpec = Schema.Struct({
  source: Schema.Literals(INVENTORY_COLLECTION_SOURCES),
  where: Schema.optionalKey(SubsetPredicate),
  orderBy: Schema.Array(SubsetOrderClause),
  limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type InventorySubsetSpec = typeof InventorySubsetSpec.Type;

export const InventorySubsetBatch = Schema.Array(
  InventorySubsetSpec.check(
    Schema.makeFilter((spec) => spec.limit <= MAX_BATCH_ROWS, {
      title: "Batch specification within the row bound",
    }),
  ),
).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BATCH_SPECS));
export type InventorySubsetBatch = typeof InventorySubsetBatch.Type;

type ResolvedSubsetOrderClause = Required<SubsetOrderClause>;

export const resolveSubsetOrder = (
  spec: Pick<InventorySubsetSpec, "source" | "orderBy">,
): ReadonlyArray<ResolvedSubsetOrderClause> =>
  spec.orderBy.map((clause) => ({
    column: clause.column,
    direction: clause.direction,
    nulls: clause.nulls ?? (clause.direction === "asc" ? "first" : "last"),
    collation:
      clause.collation ??
      (CASE_INSENSITIVE_ORDER_COLUMNS[spec.source].has(clause.column) ? "nocase" : "binary"),
  }));

export const InventorySubsetSummarySpec = Schema.Struct({
  source: Schema.Literals(INVENTORY_COLLECTION_SOURCES),
  where: Schema.optionalKey(SubsetPredicate),
  distinct: Schema.Array(SubsetColumn).check(Schema.isMaxLength(MAX_DISTINCT_COLUMNS)),
});
export type InventorySubsetSummarySpec = typeof InventorySubsetSummarySpec.Type;

export const InventorySubsetSummary = Schema.Struct({
  count: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  distinct: Schema.Array(
    Schema.Struct({ column: SubsetColumn, values: Schema.Array(Schema.String) }),
  ),
});
export type InventorySubsetSummary = typeof InventorySubsetSummary.Type;
