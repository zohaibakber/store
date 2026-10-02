import type { ReplicaCommitNotice as CatalogCommitNotice } from "@store/client-db";
import {
  InsightsContext,
  InsightsSummaryRead,
  ProductInsightIds,
  ProductInsightsRead,
  RestockPageRead,
  RestockPageRequest,
  SyncEntity,
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

const ANALYTICS_PERMANENT_STREAMS = 1;
const ANALYTICS_CONTROL_SLOTS = 4;
const ANALYTICS_FINITE_READS = 4;
export const ANALYTICS_WORKER_RPC_CONCURRENCY =
  ANALYTICS_PERMANENT_STREAMS + ANALYTICS_CONTROL_SLOTS + ANALYTICS_FINITE_READS;

export const AnalyticsWorkerBoot = Schema.Struct({
  replicaDatabasePath: Schema.String,
  analyticsDatabasePath: Schema.String,
});

export class AnalyticsWorkerFailure extends Schema.TaggedError<AnalyticsWorkerFailure>()(
  "AnalyticsWorkerFailure",
  { message: Schema.String },
) {}

export const AnalyticsEvent = Schema.Struct({
  revision: Schema.Natural,
  state: Schema.Literals(["idle", "building", "refreshing"]),
  progress: Schema.NullOr(
    Schema.Struct({
      done: Schema.Natural,
      total: Schema.Natural,
    }),
  ),
});
export type AnalyticsEvent = typeof AnalyticsEvent.Type;

const ANALYTICS_NOTICE_TOKEN = "analytics";

const isSyncEntity = Schema.is(SyncEntity);

export const analyticsNoticeOf = ({
  overflowedEntities,
  ...notice
}: typeof ReplicaCommitNotice.Type): CatalogCommitNotice =>
  Object.assign(
    {
      ...notice,
      workspaceToken: ANALYTICS_NOTICE_TOKEN,
      touchedEntities: notice.touchedEntities.filter(isSyncEntity),
    },
    overflowedEntities === undefined
      ? undefined
      : { overflowedEntities: overflowedEntities.filter(isSyncEntity) },
  );

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
