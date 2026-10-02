import {
  decodeProductSqliteRows,
  type InventorySubsetSummary,
  type ProductRow,
  type ReplicaSubsetReader,
  type ReplicaSummaryReader,
  type SubsetPredicate,
} from "@store/client-db";
import * as Effect from "effect/Effect";

import { WorkspaceReadFailure } from "./errors";
import { allOf, pageSpec, summarySpec } from "./list-page";
import { MAX_LIST_SEARCH_LENGTH, type ListPage, type ProductSortColumn } from "./list-request";
import { containsToken, searchTokens } from "./search";

export const PRODUCT_FACET_COLUMNS = [
  "categoryId",
  "name",
  "aisle",
  "composition",
  "strength",
] as const;
export type ProductFacetColumn = (typeof PRODUCT_FACET_COLUMNS)[number];

export type ProductListFilters = {
  readonly search?: string;
  readonly categoryId?: string;
  readonly aisle?: string;
  readonly composition?: string;
  readonly strength?: string;
};

export type ProductListRequest = ListPage<ProductSortColumn> & {
  readonly filters: ProductListFilters;
};

export type ProductFacets = Readonly<Record<ProductFacetColumn, ReadonlyArray<string>>>;

const exactly = (column: string, value: string): SubsetPredicate => ({
  _tag: "like",
  column,
  pattern: value,
});

const productListWhere = (filters: ProductListFilters): SubsetPredicate | undefined =>
  allOf([
    ...searchTokens((filters.search ?? "").slice(0, MAX_LIST_SEARCH_LENGTH)).map(containsToken),
    ...(filters.categoryId
      ? [{ _tag: "compare", column: "categoryId", op: "eq", value: filters.categoryId } as const]
      : []),
    ...(filters.aisle ? [exactly("aisle", filters.aisle)] : []),
    ...(filters.composition ? [exactly("composition", filters.composition)] : []),
    ...(filters.strength ? [exactly("strength", filters.strength)] : []),
  ]);

const readFailure = () =>
  new WorkspaceReadFailure({ message: "Could not read products on this device." });

export const readProductPage = (
  reader: ReplicaSubsetReader,
  request: ProductListRequest,
): Effect.Effect<ReadonlyArray<ProductRow>, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => reader.readSubset(pageSpec("products", productListWhere(request.filters), request)),
    catch: readFailure,
  }).pipe(
    Effect.flatMap((read) => decodeProductSqliteRows(read.rows)),
    Effect.mapError(readFailure),
    Effect.withSpan("ProductList.readPage"),
  );

export const summarizeProducts = (
  reader: ReplicaSummaryReader,
  filters: ProductListFilters,
  distinct: ReadonlyArray<ProductFacetColumn>,
): Effect.Effect<InventorySubsetSummary, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => reader.summarizeSubset(summarySpec("products", productListWhere(filters), distinct)),
    catch: readFailure,
  }).pipe(
    Effect.map((read) => read.summary),
    Effect.withSpan("ProductList.summarize"),
  );

const NAME_LOOKUP_CONCURRENCY = 4;
const NAME_LOOKUP_LIMIT = 20;

export const findProductsByNames = (
  reader: ReplicaSubsetReader,
  names: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ProductRow>, WorkspaceReadFailure> =>
  Effect.forEach(
    [...new Set(names.map((name) => name.trim()).filter((name) => name !== ""))],
    (name) =>
      Effect.tryPromise({
        try: () =>
          reader.readSubset({
            source: "products",
            where: exactly("name", name),
            orderBy: [{ column: "id", direction: "asc" }],
            limit: NAME_LOOKUP_LIMIT,
            offset: 0,
          }),
        catch: readFailure,
      }).pipe(Effect.flatMap((read) => decodeProductSqliteRows(read.rows))),
    { concurrency: NAME_LOOKUP_CONCURRENCY },
  ).pipe(
    Effect.map((groups) => [...new Map(groups.flat().map((row) => [row.id, row])).values()]),
    Effect.mapError(readFailure),
    Effect.withSpan("ProductList.findByNames"),
  );

export const facetsFrom = (summary: InventorySubsetSummary) => {
  const valuesOf = (column: ProductFacetColumn) =>
    summary.distinct.find((entry) => entry.column === column)?.values ?? [];
  return {
    categoryId: valuesOf("categoryId"),
    name: valuesOf("name"),
    aisle: valuesOf("aisle"),
    composition: valuesOf("composition"),
    strength: valuesOf("strength"),
  } satisfies ProductFacets;
};
