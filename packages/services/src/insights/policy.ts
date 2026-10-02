import type { AbcClass, StockPolicy } from "@store/contracts/sync/replica-analytics";

export const DEFAULT_STOCK_POLICY: StockPolicy = {
  leadDays: 7,
  coverDays: 21,
  serviceLevel: 0.95,
  minimumUnits: 10,
  expiryWarningDays: 60,
  deadStockDays: 60,
  overstockDays: 150,
};

const SERVICE_LEVEL_SHIFT = { A: 0.02, B: 0, C: -0.05 } satisfies Record<AbcClass, number>;

export const serviceLevelFor = (policy: StockPolicy, abc: AbcClass) =>
  Math.min(0.995, Math.max(0.8, policy.serviceLevel + SERVICE_LEVEL_SHIFT[abc]));
