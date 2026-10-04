import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import {
  InsightsContext,
  InsightsSummaryRead,
  ProductInsightIds,
  ProductInsightsRead,
  RestockPageRead,
  RestockPageRequest,
} from "../sync/replica-analytics";
import { ReplicaInsightsFacts, ReplicaInsightsWindow } from "../sync/replica-insights";
import { ReadFailure } from "./errors";
import { Stamp } from "./notices";

export const InsightsChange = Schema.Struct({
  revision: Schema.Natural,
  state: Schema.Literals(["idle", "building", "refreshing"]),
  progress: Schema.NullOr(Schema.Struct({ done: Schema.Natural, total: Schema.Natural })),
});
export type InsightsChange = typeof InsightsChange.Type;

export class InventoryInsights extends RpcGroup.make(
  Rpc.make("InsightsSummary", {
    payload: { context: InsightsContext },
    success: InsightsSummaryRead,
    error: ReadFailure,
  }),
  Rpc.make("ProductInsights", {
    payload: { context: InsightsContext, ids: ProductInsightIds },
    success: ProductInsightsRead,
    error: ReadFailure,
  }),
  Rpc.make("RestockPage", {
    payload: { context: InsightsContext, request: RestockPageRequest },
    success: RestockPageRead,
    error: ReadFailure,
  }),
  Rpc.make("InsightsFacts", {
    payload: { window: ReplicaInsightsWindow },
    success: Schema.Struct({ stamp: Stamp, facts: ReplicaInsightsFacts }),
    error: ReadFailure,
  }),
  Rpc.make("Changes", { success: InsightsChange, stream: true }),
) {}
