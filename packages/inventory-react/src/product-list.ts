import {
  decodeProductSqliteRows,
  type InventorySubsetSpec,
  type InventorySubsetSummary,
  type InventorySubsetSummarySpec,
  type ProductRow,
  type ReplicaSubsetReader,
  type ReplicaSummaryReader,
  type SubsetPredicate,
} from "@store/client-db";
import * as Effect from "effect/Effect";

import { WorkspaceReadFailure } from "./errors";
import { containsToken, searchTokens } from "./search";

export const PRODUCT_SORT_COLUMNS = [
  "name",
  "aisle",
  "unitsPerPack",
  "purchasePrice",
  "retailPrice",
  "unitPrice",
  "updatedAt",
] as const;
export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number];

export const PRODUCT_FACET_COLUMNS = [
  "categoryId",
  "name",
  "aisle",
  "composition",
  "strength",
] as const;
export type ProductFacetColumn = (typeof PRODUCT_FACET_COLUMNS)[number];

export const MAX_PRODUCT_PAGE_SIZE = 100;

const MAX_SEARCH_LENGTH = 120;

export type ProductListFilters = {
  readonly search?: string;
  readonly categoryId?: string;
  readonly aisle?: string;
  readonly composition?: string;
  readonly strength?: string;
};

export type ProductListRequest = {
  readonly filters: ProductListFilters;
  readonly sort: { readonly column: ProductSortColumn; readonly direction: "asc" | "desc" };
  readonly pageIndex: number;
  readonly pageSize: number;
};

export type ProductFacets = Readonly<Record<ProductFacetColumn, ReadonlyArray<string>>>;

const exactly = (column: string, value: string): SubsetPredicate => ({
  _tag: "like",
  column,
  pattern: value,
});

export const productListWhere = (filters: ProductListFilters): SubsetPredicate | undefined => {
  const predicates: Array<SubsetPredicate> = [
    ...searchTokens((filters.search ?? "").slice(0, MAX_SEARCH_LENGTH)).map(containsToken),
    ...(filters.categoryId
      ? [{ _tag: "compare", column: "categoryId", op: "eq", value: filters.categoryId } as const]
      : []),
    ...(filters.aisle ? [exactly("aisle", filters.aisle)] : []),
    ...(filters.composition ? [exactly("composition", filters.composition)] : []),
    ...(filters.strength ? [exactly("strength", filters.strength)] : []),
  ];
  if (predicates.length === 0) return undefined;
  return predicates.length === 1 ? predicates[0] : { _tag: "and", predicates };
};

export const productPageSpec = (request: ProductListRequest): InventorySubsetSpec => {
  const pageSize = Math.min(MAX_PRODUCT_PAGE_SIZE, Math.max(1, Math.floor(request.pageSize)));
  const where = productListWhere(request.filters);
  const spec: InventorySubsetSpec = {
    source: "products",
    orderBy: [
      { column: request.sort.column, direction: request.sort.direction },
      { column: "id", direction: "asc" },
    ],
    limit: pageSize,
    offset: Math.max(0, Math.floor(request.pageIndex)) * pageSize,
  };
  return where ? { ...spec, where } : spec;
};

export const productSummarySpec = (
  filters: ProductListFilters,
  distinct: ReadonlyArray<ProductFacetColumn>,
): InventorySubsetSummarySpec => {
  const where = productListWhere(filters);
  return where ? { source: "products", where, distinct } : { source: "products", distinct };
};

const readFailure = () =>
  new WorkspaceReadFailure({ message: "Could not read products on this device." });

export const readProductPage = (
  reader: ReplicaSubsetReader,
  request: ProductListRequest,
): Effect.Effect<ReadonlyArray<ProductRow>, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => reader.readSubset(productPageSpec(request)),
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
    try: () => reader.summarizeSubset(productSummarySpec(filters, distinct)),
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
