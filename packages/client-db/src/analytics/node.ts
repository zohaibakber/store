export { analyticsDatabasePath, openAnalyticsDatabase } from "./database";
export { AnalyticsFailure, analyticsFailure } from "./errors";
export {
  openInventorySource,
  type InventorySnapshot,
  type InventorySource,
  type InventoryStamp,
  type SalesDays,
} from "./source";
export {
  makeAnalyticsStore,
  type AnalyticsStore,
  type ProductAnalysis,
  type SalesRow,
  type StagedProduct,
  type SummaryReader,
} from "./store";
