import * as Effect from "effect/Effect";

import { UnsupportedSubsetQuery } from "./errors";
import { DISTINCT_COLUMNS, FILTER_COLUMNS } from "./sources";
import type { InventorySubsetSummarySpec, SubsetPredicate } from "./subset-spec";

export const rejectColumn = (column: string) =>
  new UnsupportedSubsetQuery({
    message: `Unsupported subset query: column ${column} is not allowlisted`,
    reason: `column ${column} is not allowlisted`,
  });

export const allowlisted = (
  column: string,
  columns: ReadonlySet<string>,
): Effect.Effect<string, UnsupportedSubsetQuery> =>
  columns.has(column) ? Effect.succeed(column) : Effect.fail(rejectColumn(column));

const predicateColumns = (predicate: SubsetPredicate): ReadonlyArray<string> => {
  switch (predicate._tag) {
    case "and":
    case "or":
      return predicate.predicates.flatMap(predicateColumns);
    case "not":
      return predicateColumns(predicate.predicate);
    case "compare":
    case "in":
    case "isNull":
    case "like":
      return [predicate.column];
  }
};

export const validateSummarySpec = (
  spec: InventorySubsetSummarySpec,
): Effect.Effect<InventorySubsetSummarySpec, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const filters = spec.where ? predicateColumns(spec.where) : [];
    yield* Effect.forEach(filters, (column) => allowlisted(column, FILTER_COLUMNS[spec.source]));
    yield* Effect.forEach(spec.distinct, (column) =>
      allowlisted(column, DISTINCT_COLUMNS[spec.source]),
    );
    return spec;
  });
