import { Schema } from "effect";

const between = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isBetween({ minimum, maximum }));
const wholeBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const StockPolicy = Schema.Struct({
  leadDays: wholeBetween(0, 90),
  coverDays: wholeBetween(1, 120),
  serviceLevel: between(0.8, 0.995),
  minimumUnits: wholeBetween(0, 10_000),
  expiryWarningDays: wholeBetween(7, 365),
  deadStockDays: wholeBetween(14, 365),
  overstockDays: wholeBetween(30, 730),
});
export type StockPolicy = typeof StockPolicy.Type;

export const DEFAULT_STOCK_POLICY: StockPolicy = {
  leadDays: 7,
  coverDays: 21,
  serviceLevel: 0.95,
  minimumUnits: 10,
  expiryWarningDays: 60,
  deadStockDays: 60,
  overstockDays: 150,
};

export type AbcClass = "A" | "B" | "C";

const SERVICE_LEVEL_SHIFT = { A: 0.02, B: 0, C: -0.05 } satisfies Record<AbcClass, number>;

export const serviceLevelFor = (policy: StockPolicy, abc: AbcClass) =>
  Math.min(0.995, Math.max(0.8, policy.serviceLevel + SERVICE_LEVEL_SHIFT[abc]));
