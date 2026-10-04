import * as Schema from "effect/Schema";

import { MAX_HISTORY_ROWS, MAX_IN_VALUES } from "../limits";
import { Stamp } from "../notices";

export const IdList = <Id extends Schema.Top>(id: Id) =>
  Schema.Array(id).check(Schema.isMaxLength(MAX_IN_VALUES));

export const HistoryLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_HISTORY_ROWS }),
);

export const HistoryCursor = Schema.Struct({ createdAt: Schema.Number, id: Schema.String });
export type HistoryCursor = typeof HistoryCursor.Type;

export const HistoryPage = {
  limit: HistoryLimit,
  before: Schema.optionalKey(HistoryCursor),
};

export const HistoryWindow = <Row extends Schema.Top>(row: Row) =>
  Schema.Struct({
    stamp: Stamp,
    rows: Schema.Array(row),
    hasMore: Schema.Boolean,
    next: Schema.NullOr(HistoryCursor),
  });

export const Count = Schema.Struct({ stamp: Stamp, count: Schema.Natural });
export type Count = typeof Count.Type;
