import { InventoryInsights } from "@store/contracts/replica";
import { SqliteReplica } from "@store/sync/sql-client";
import * as Effect from "effect/Effect";

import { readInsightsFacts } from "./facts";
import { InsightsReports } from "./reports";

export { InsightsReports } from "./reports";

export const layerInventoryInsights = InventoryInsights.toLayer(
  Effect.gen(function* () {
    const reports = yield* InsightsReports;
    const replica = yield* SqliteReplica;
    return InventoryInsights.of({
      InsightsSummary: ({ context }) => reports.summary(context),
      ProductInsights: ({ context, ids }) => reports.products(context, ids),
      RestockPage: ({ context, request }) => reports.restockPage(context, request),
      InsightsFacts: ({ window }) => readInsightsFacts(replica, window),
      Changes: () => reports.changes,
    });
  }),
);
