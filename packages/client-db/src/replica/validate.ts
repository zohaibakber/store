import * as Effect from "effect/Effect";

import { UnsupportedSubsetQuery } from "./errors";
import { DISTINCT_COLUMNS, FILTER_COLUMNS, MAX_BATCH_ROWS, MAX_BATCH_SPECS } from "./sources";
import type {
  InventorySubsetSpec,
  InventorySubsetSummarySpec,
  SubsetPredicate,
} from "./subset-spec";

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

export const validateBatchSpecs = (specs: ReadonlyArray<InventorySubsetSpec>) =>
  specs.length === 0 ||
  specs.length > MAX_BATCH_SPECS ||
  specs.some((spec) => spec.limit > MAX_BATCH_ROWS)
    ? Effect.fail(
        new UnsupportedSubsetQuery({
          message: `Unsupported batch read: at most ${MAX_BATCH_SPECS} specifications of ${MAX_BATCH_ROWS} rows`,
          reason: `batch of ${specs.length} specifications exceeds the bound`,
        }),
      )
    : Effect.void;
