import { CategoryId } from "@store/contracts/ids";
import type {
  ProductFacet,
  ProductFacetColumn,
  ProductListFilters as ProductFiltersPayload,
  ProductListRequest as ProductPagePayload,
} from "@store/contracts/replica";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { boundedPage, boundedText, type ListPage, type ProductSortColumn } from "./list-request";

export { PRODUCT_FACET_COLUMNS, type ProductFacetColumn } from "@store/contracts/replica";

const decodeCategory = Schema.decodeUnknownOption(CategoryId);

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

type FilterText = "search" | "aisle" | "composition" | "strength";

const FILTER_TEXTS: ReadonlyArray<FilterText> = ["search", "aisle", "composition", "strength"];

export const productFiltersPayload = (filters: ProductListFilters): ProductFiltersPayload => {
  const texts = FILTER_TEXTS.map((key) => [key, boundedText(filters[key])] as const).filter(
    ([, text]) => text !== "",
  );
  const category = Option.map(decodeCategory(filters.categoryId), (categoryId) => ({ categoryId }));
  return { ...Object.fromEntries(texts), ...Option.getOrUndefined(category) };
};

export const productPagePayload = (request: ProductListRequest): ProductPagePayload => ({
  ...boundedPage(request),
  filters: productFiltersPayload(request.filters),
});

export const facetsFrom = (summary: { readonly distinct: ReadonlyArray<ProductFacet> }) => {
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
