import { searchTokens, type BatchRow, type CategoryRow, type ProductRow } from "@store/client-db";
import { MAX_SEARCH_QUERY_LENGTH } from "@store/contracts/replica";

export const canonicalSearchQuery = (query: string) =>
  searchTokens(query.slice(0, MAX_SEARCH_QUERY_LENGTH)).join(" ");

export type ProductSearchStock = {
  readonly products: ReadonlyArray<ProductRow>;
  readonly categories: ReadonlyArray<CategoryRow>;
  readonly batches: ReadonlyArray<BatchRow>;
};
