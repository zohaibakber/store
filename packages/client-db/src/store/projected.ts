import * as Schema from "effect/Schema";

import type { CatalogProjectionContext } from "../catalog-projection";
import type { ProductRow } from "../rows";

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

export class RowIdSupplyMismatch extends Schema.TaggedError<RowIdSupplyMismatch>()(
  "RowIdSupplyMismatch",
  { drawn: Schema.Number, taken: Schema.Number },
) {}

const placeholderRowId = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

export const countingRowIds = () => {
  let used = 0;
  return {
    used: () => used,
    rowId: () => placeholderRowId(used++),
  };
};

export const drawnRowIds = (drawn: ReadonlyArray<string>) => {
  let used = 0;
  return {
    balanced: () => used === drawn.length,
    used: () => used,
    rowId: () => {
      const id = drawn[used] ?? placeholderRowId(used);
      used += 1;
      return id;
    },
  };
};
