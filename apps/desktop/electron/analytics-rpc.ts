import {
  InsightsContext,
  InsightsSummaryRead,
  ProductInsightIds,
  ProductInsightsRead,
  RestockPageRead,
  RestockPageRequest,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ReplicaCommitNotice, ReplicaWorkspaceToken } from "./replica-rpc";

export const ReplicaInsightsSummaryInput = Schema.Struct({
  workspaceToken: ReplicaWorkspaceToken,
  context: InsightsContext,
});

export const ReplicaProductInsightsInput = Schema.Struct({
  workspaceToken: ReplicaWorkspaceToken,
  context: InsightsContext,
  ids: ProductInsightIds,
});

export const ReplicaRestockPageInput = Schema.Struct({
  workspaceToken: ReplicaWorkspaceToken,
  context: InsightsContext,
  request: RestockPageRequest,
});

export const AnalyticsWorkerBoot = Schema.Struct({
  replicaDatabasePath: Schema.String,
  analyticsDatabasePath: Schema.String,
});

export class AnalyticsWorkerFailure extends Schema.TaggedError<AnalyticsWorkerFailure>()(
  "AnalyticsWorkerFailure",
  { message: Schema.String },
) {}

export const AnalyticsEvent = Schema.Struct({
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  state: Schema.Literals(["idle", "building", "refreshing"]),
  progress: Schema.NullOr(
    Schema.Struct({
      done: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      total: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type AnalyticsEvent = typeof AnalyticsEvent.Type;

export const AnalyticsWorkerRpcs = RpcGroup.make(
  Rpc.make("Ready", { success: Schema.Literal("ready"), error: AnalyticsWorkerFailure }),
  Rpc.make("Notify", { payload: { notice: ReplicaCommitNotice } }),
  Rpc.make("ReadSummary", {
    payload: { context: InsightsContext },
    success: InsightsSummaryRead,
    error: AnalyticsWorkerFailure,
  }),
  Rpc.make("ReadProducts", {
    payload: { context: InsightsContext, ids: ProductInsightIds },
    success: ProductInsightsRead,
    error: AnalyticsWorkerFailure,
  }),
  Rpc.make("ReadRestockPage", {
    payload: { context: InsightsContext, request: RestockPageRequest },
    success: RestockPageRead,
    error: AnalyticsWorkerFailure,
  }),
  Rpc.make("Changes", { success: AnalyticsEvent, stream: true }),
);
