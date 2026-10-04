import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { BatchRow, CategoryRow, ProductRow } from "../../sync/entity-rows";
import { ReadFailure } from "../errors";
import { MAX_PRODUCT_SEARCH_RESULTS, MAX_SEARCH_QUERIES, MAX_SEARCH_QUERY_LENGTH } from "../limits";
import { Stamp } from "../notices";

export const SearchQuery = Schema.String.check(Schema.isMaxLength(MAX_SEARCH_QUERY_LENGTH));

export const SearchLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_PRODUCT_SEARCH_RESULTS }),
);

export class SearchReads extends RpcGroup.make(
  Rpc.make("SearchProducts", {
    payload: {
      queries: Schema.Array(SearchQuery).check(Schema.isMaxLength(MAX_SEARCH_QUERIES)),
      limit: SearchLimit,
    },
    success: Schema.Struct({ stamp: Stamp, products: Schema.Array(ProductRow) }),
    error: ReadFailure,
  }),
  Rpc.make("SearchProductStock", {
    payload: { query: SearchQuery, limit: SearchLimit },
    success: Schema.Struct({
      stamp: Stamp,
      products: Schema.Array(ProductRow),
      categories: Schema.Array(CategoryRow),
      batches: Schema.Array(BatchRow),
    }),
    error: ReadFailure,
  }),
) {}
