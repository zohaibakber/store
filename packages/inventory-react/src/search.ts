import { searchTokens } from "@store/client-db";
import type { ReplicaBatchRow, ReplicaCategoryRow, ReplicaProductRow } from "@store/contracts";
import { MAX_SEARCH_QUERY_LENGTH } from "@store/contracts/replica";

export const canonicalSearchQuery = (query: string) =>
  searchTokens(query.slice(0, MAX_SEARCH_QUERY_LENGTH)).join(" ");

export type ProductSearchStock = {
  readonly products: ReadonlyArray<ReplicaProductRow>;
  readonly categories: ReadonlyArray<ReplicaCategoryRow>;
  readonly batches: ReadonlyArray<ReplicaBatchRow>;
};
