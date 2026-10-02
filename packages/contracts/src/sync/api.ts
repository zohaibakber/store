import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import { publicErrorSchema } from "../http-errors";
import { PositiveIntFromString, SyncIdentifier } from "../schema-primitives";
import { DeviceCommand, OrganizationDevices } from "./devices";
import {
  ImportCatalogRequest,
  ImportCatalogResult,
  ImportId,
  ImportPartReceipt,
  MAX_IMPORT_PARTS,
} from "./import";
import {
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SyncPullRequest,
  SyncPullResult,
  SyncSubmitCommandRequest,
  SyncSubmitCommandResult,
} from "./protocol";
import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  SnapshotId,
  SnapshotPartPayload,
} from "./snapshot";

export const SyncBadRequest = publicErrorSchema("BadRequest", 400);
export type SyncBadRequest = typeof SyncBadRequest.Type;

export const SyncForbidden = publicErrorSchema("Forbidden", 403);
export type SyncForbidden = typeof SyncForbidden.Type;

export const SyncNotFound = publicErrorSchema("NotFound", 404);
export type SyncNotFound = typeof SyncNotFound.Type;

export const SyncConflict = publicErrorSchema("Conflict", 409);
export type SyncConflict = typeof SyncConflict.Type;

export const SyncServiceUnavailable = publicErrorSchema("ServiceUnavailable", 503);
export type SyncServiceUnavailable = typeof SyncServiceUnavailable.Type;

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
      payload: SyncSubmitCommandRequest,
      success: SyncSubmitCommandResult,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getReceipt", "/api/sync/receipts/:operationId", {
      params: Schema.Struct({
        operationId: SyncIdentifier,
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
        partNumber: PositiveIntFromString,
      }),
      success: SnapshotPartPayload,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("stageImportPart", "/api/sync/imports/:importId/parts/:partNumber", {
      params: Schema.Struct({
        importId: ImportId,
        partNumber: Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_IMPORT_PARTS })),
        ),
      }),
      payload: SnapshotPartPayload,
      success: ImportPartReceipt,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("commitImport", "/api/sync/imports/:importId/commit", {
      params: Schema.Struct({ importId: ImportId }),
      payload: ImportCatalogRequest,
      success: ImportCatalogResult,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDevices", "/api/sync/devices", {
      success: OrganizationDevices,
      error: SyncHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("commandDevice", "/api/sync/devices", {
      payload: DeviceCommand,
      success: OrganizationDevices,
      error: SyncHttpErrors,
    }),
  );

export const SyncHttpApi = HttpApi.make("SyncHttpApi").add(syncGroup);
