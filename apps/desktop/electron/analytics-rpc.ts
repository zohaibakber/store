import type { ReplicaCommitNotice as CatalogCommitNotice } from "@store/client-db";
import { SyncEntity } from "@store/contracts";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AttachRendererRpc, ReplicaCommitNotice } from "./replica-rpc";

export const ANALYTICS_WORKER_RPC_CONCURRENCY = 4;

export const AnalyticsWorkerBoot = Schema.Struct({
  replicaDatabasePath: Schema.String,
  analyticsDatabasePath: Schema.String,
});

export class AnalyticsWorkerFailure extends Schema.TaggedError<AnalyticsWorkerFailure>()(
  "AnalyticsWorkerFailure",
  { message: Schema.String },
) {}

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
  AttachRendererRpc,
  Rpc.make("Notify", { payload: { notice: ReplicaCommitNotice } }),
);
