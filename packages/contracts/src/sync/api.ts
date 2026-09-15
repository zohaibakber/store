import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  SyncBadRequest,
  SyncConflict,
  SyncForbidden,
  SyncNotFound,
  SyncServiceUnavailable,
} from "./http-errors";
import {
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SyncCommandEnvelope,
  SyncPullRequest,
  SyncPullResult,
} from "./protocol";

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
  );

export const SyncHttpApi = HttpApi.make("SyncHttpApi").add(syncGroup);
