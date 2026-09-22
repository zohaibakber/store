import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import {
  SyncBadRequest,
  SyncConflict,
  SyncForbidden,
  SyncNotFound,
  SyncServiceUnavailable,
} from "./http-errors";
import {
  LiveTicket,
  LiveTicketRequest,
  LiveUpgradeQuery,
  SyncLiveSseEvent,
  SyncLiveWakeHint,
} from "./live";
import {
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SyncCommandEnvelope,
  SyncPullRequest,
  SyncPullResult,
} from "./protocol";
import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  SnapshotId,
  SnapshotPartPayload,
} from "./snapshot";

const SyncHttpErrors = [
  SyncBadRequest,
  SyncForbidden,
  SyncConflict,
  SyncNotFound,
  SyncServiceUnavailable,
] as const;

export const syncGroup = HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.post("registerReplica", "/api/sync/replicas", {
      payload: RegisterReplicaRequest,
      success: RegisterReplicaResult,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("submitCommand", "/api/sync/commands", {
      payload: SyncCommandEnvelope,
      success: CommandReceipt,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getReceipt", "/api/sync/receipts/:operationId", {
      params: Schema.Struct({
        operationId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      }),
      success: CommandReceipt,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("pull", "/api/sync/pull", {
      payload: SyncPullRequest,
      success: SyncPullResult,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("acquireSnapshot", "/api/sync/snapshots", {
      payload: AcquireSnapshotRequest,
      success: AcquireSnapshotResult,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("readSnapshotPart", "/api/sync/snapshots/:snapshotId/parts/:partNumber", {
      params: Schema.Struct({
        snapshotId: SnapshotId,
        partNumber: Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
        ),
      }),
      success: SnapshotPartPayload,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("mintLiveTicket", "/api/sync/live-tickets", {
      payload: LiveTicketRequest,
      success: LiveTicket,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("liveUpgrade", "/api/sync/live", {
      query: LiveUpgradeQuery,
      success: [
        SyncLiveWakeHint,
        HttpApiSchema.NoContent,
        HttpApiSchema.StreamSse({ events: SyncLiveSseEvent }),
      ],
      error: SyncHttpErrors,
    }),
  );

export const SyncHttpApi = HttpApi.make("SyncHttpApi").add(syncGroup);
