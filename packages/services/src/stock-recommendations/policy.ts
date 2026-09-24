import { Schema } from "effect";

const days = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const StockPolicy = Schema.Struct({
  leadDays: days(0, 90),
  safetyDays: days(0, 30),
  coverDays: days(1, 90),
  minimumUnits: days(0, 10000),
});
export type StockPolicy = typeof StockPolicy.Type;

export const DEFAULT_STOCK_POLICY: StockPolicy = {
  leadDays: 7,
  safetyDays: 3,
  coverDays: 30,
  minimumUnits: 10,
};
