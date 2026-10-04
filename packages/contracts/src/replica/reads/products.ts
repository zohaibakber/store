import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { MAX_CATALOG_NAME_LENGTH } from "../../catalog/write";
import { ProductId } from "../../ids";
import { Category, Product, StockMovement } from "../../store/schema";
import { ProductRow } from "../../sync/entity-rows";
import { ReadFailure } from "../errors";
import { MAX_IN_VALUES } from "../limits";
import { PRODUCT_FACET_COLUMNS, ProductListFilters, ProductListRequest } from "../list-request";
import { Stamp } from "../notices";
import { HistoryPage, HistoryWindow, IdList } from "./shared";

const ProductFacetColumn = Schema.Literals(PRODUCT_FACET_COLUMNS);

export const ProductFacet = Schema.Struct({
  column: ProductFacetColumn,
  values: Schema.Array(Schema.String),
});
export type ProductFacet = typeof ProductFacet.Type;

const ProductName = Schema.NonEmptyString.check(Schema.isMaxLength(MAX_CATALOG_NAME_LENGTH));

export class ProductReads extends RpcGroup.make(
  Rpc.make("ProductPage", {
    payload: ProductListRequest,
    success: Schema.Struct({ stamp: Stamp, products: Schema.Array(ProductRow) }),
    error: ReadFailure,
  }),
  Rpc.make("ProductSummary", {
    payload: {
      filters: ProductListFilters,
      distinct: Schema.Array(ProductFacetColumn).check(
        Schema.isMaxLength(PRODUCT_FACET_COLUMNS.length),
      ),
    },
    success: Schema.Struct({
      stamp: Stamp,
      count: Schema.Natural,
      distinct: Schema.Array(ProductFacet),
    }),
    error: ReadFailure,
  }),
  Rpc.make("ProductsById", {
    payload: { ids: IdList(ProductId) },
    success: Schema.Struct({ stamp: Stamp, products: Schema.Array(Product) }),
    error: ReadFailure,
  }),
  Rpc.make("ProductsByNames", {
    payload: { names: Schema.Array(ProductName).check(Schema.isMaxLength(MAX_IN_VALUES)) },
    success: Schema.Struct({ stamp: Stamp, products: Schema.Array(ProductRow) }),
    error: ReadFailure,
  }),
  Rpc.make("Categories", {
    success: Schema.Struct({ stamp: Stamp, categories: Schema.Array(Category) }),
    error: ReadFailure,
  }),
  Rpc.make("StockMovementHistory", {
    payload: { productId: ProductId, ...HistoryPage },
    success: HistoryWindow(StockMovement),
    error: ReadFailure,
  }),
) {}
