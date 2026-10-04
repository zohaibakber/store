import * as Arr from "effect/Array";
import * as Order from "effect/Order";

type Named = { readonly name: string; readonly id: string };

const localeName = Order.combine(
  Order.make<Named>((left, right) => {
    const compared = left.name.localeCompare(right.name);
    return compared < 0 ? -1 : compared > 0 ? 1 : 0;
  }),
  Order.mapInput(Order.String, (row: Named) => row.id),
);

export const byLocaleName = <Row extends Named>(rows: ReadonlyArray<Row>): ReadonlyArray<Row> =>
  Arr.sort(rows, localeName);

export type HistoryWindow<Row> = {
  readonly rows: ReadonlyArray<Row>;
  readonly hasMore: boolean;
  readonly limit: number;
};

export const historyLimit = (pageSize: number, pages: number) =>
  Math.max(1, Math.floor(pageSize)) * Math.max(1, Math.floor(pages));
