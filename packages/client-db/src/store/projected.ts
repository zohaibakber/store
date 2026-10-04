import type { CreateCategoryInput } from "@store/contracts";
import { MAX_CATALOG_WRITE_ROWS, type CatalogRowWrite } from "@store/contracts/catalog-write";
import * as Result from "effect/Result";

import { projectCreateCategory, type CatalogProjectionContext } from "../catalog-projection";
import type { CategoryRow, ProductRow } from "../rows";

export type Projected<Row> = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
  readonly row: Row;
};

type RowState<Row> = {
  readonly get: (id: string) => Row | undefined;
  readonly values: () => Iterable<Row>;
};

const withRow = <Row extends { readonly id: string }>(state: RowState<Row>, row: Row) => ({
  state: {
    get: (id: string) => (id === row.id ? row : state.get(id)),
    values: function* () {
      yield row;
      yield* state.values();
    },
  },
});

export const withProjectedProduct = (
  context: CatalogProjectionContext,
  product: ProductRow,
): CatalogProjectionContext => ({
  ...context,
  tables: { ...context.tables, products: withRow(context.tables.products.state, product) },
});

const withProjectedCategory = (
  context: CatalogProjectionContext,
  category: CategoryRow,
): CatalogProjectionContext => ({
  ...context,
  tables: { ...context.tables, categories: withRow(context.tables.categories.state, category) },
});

export const leadingChunks = (
  leading: ReadonlyArray<CatalogRowWrite>,
  chunks: ReadonlyArray<ReadonlyArray<CatalogRowWrite>>,
): ReadonlyArray<ReadonlyArray<CatalogRowWrite>> => {
  if (leading.length === 0) return chunks;
  const [first = [], ...rest] = chunks;
  return leading.length + first.length <= MAX_CATALOG_WRITE_ROWS
    ? [[...leading, ...first], ...rest]
    : [leading, ...chunks];
};

export const importCategory = (context: CatalogProjectionContext, input: CreateCategoryInput) =>
  Result.gen(function* () {
    const projected = yield* projectCreateCategory(context, input);
    return {
      writes: projected.writes,
      id: projected.row.id,
      tables: withProjectedCategory(context, projected.row).tables,
    };
  });

export const removed = (projection: {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
}): Projected<void> => ({ writes: projection.writes, row: undefined });
