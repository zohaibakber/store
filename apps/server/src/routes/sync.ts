import type { SyncProtocolError } from "@store/contracts";
import {
  SyncBadRequest,
  SyncConflict,
  SyncForbidden,
  SyncNotFound,
  SyncServiceUnavailable,
} from "@store/contracts/sync/http-errors";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import type { InventorySyncActor } from "../inventory/organization-host";
import { SyncAuthority, SyncUnavailableError } from "../inventory/sync-authority";

const body = (code: string, message: string) => ({ error: { code, message } });

export const syncProtocolError = (error: SyncProtocolError) => {
  switch (error.code) {
    case "ORGANIZATION_MISMATCH":
    case "ACTOR_MISMATCH":
    case "REPLICA_OWNED_BY_OTHER":
      return SyncForbidden.make(body(error.code, error.message));
    case "OPERATION_ID_REUSED":
    case "INSUFFICIENT_STOCK":
    case "INVOICE_IDENTITY_CONFLICT":
    case "ENTITY_CONFLICT":
    case "ENTITY_RELATION_INVALID":
    case "REPLICA_SEQUENCE_GAP":
    case "EPOCH_MISMATCH":
    case "REPLICA_UNKNOWN":
    case "SNAPSHOT_REQUIRED":
    case "SNAPSHOT_UNAVAILABLE":
    case "IMPORT_IDENTITY_MISMATCH":
    case "INCARNATION_MISMATCH":
      return SyncConflict.make(body(error.code, error.message));
    default:
      return SyncBadRequest.make(body(error.code, error.message));
  }
};

export const mapSyncError = (error: SyncProtocolError | SyncUnavailableError) => {
  if (error._tag === "SyncUnavailableError") {
    return SyncServiceUnavailable.make(body("SYNC_NOT_PROVISIONED", error.message));
  }
  return syncProtocolError(error);
};

export const syncErrorStatus = (error: SyncProtocolError | SyncUnavailableError): number => {
  if (error._tag === "SyncUnavailableError") return 503;
  switch (error.code) {
    case "ORGANIZATION_MISMATCH":
    case "ACTOR_MISMATCH":
    case "REPLICA_OWNED_BY_OTHER":
      return 403;
    case "OPERATION_ID_REUSED":
    case "INSUFFICIENT_STOCK":
    case "INVOICE_IDENTITY_CONFLICT":
    case "ENTITY_CONFLICT":
    case "ENTITY_RELATION_INVALID":
    case "REPLICA_SEQUENCE_GAP":
    case "EPOCH_MISMATCH":
    case "REPLICA_UNKNOWN":
    case "SNAPSHOT_REQUIRED":
    case "SNAPSHOT_UNAVAILABLE":
    case "IMPORT_IDENTITY_MISMATCH":
    case "INCARNATION_MISMATCH":
      return 409;
    default:
      return 400;
  }
};

export const syncActor = (identity: {
  readonly organizationId: string;
  readonly user: { readonly id: string };
  readonly session: { readonly expiresAt: number };
}): InventorySyncActor => ({
  organizationId: identity.organizationId,
  userId: identity.user.id,
  authorizationExpiresAt: identity.session.expiresAt,
});

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn("SyncHandlers.make")(function* (handlers) {
    const authority = yield* SyncAuthority;

    return handlers
      .handle(
        "registerReplica",
        Effect.fn("SyncHandlers.registerReplica")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .registerReplica(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "submitCommand",
        Effect.fn("SyncHandlers.submitCommand")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .submitCommand(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "getReceipt",
        Effect.fn("SyncHandlers.getReceipt")(function* ({ params }) {
          const identity = yield* CurrentOrganization;
          const receipt = yield* authority
            .getReceipt(syncActor(identity), params.operationId)
            .pipe(Effect.mapError(mapSyncError));
          if (!receipt) {
            return yield* Effect.fail(
              SyncNotFound.make(body("RECEIPT_NOT_FOUND", "No receipt for that command.")),
            );
          }
          return receipt;
        }),
      )
      .handle(
        "pull",
        Effect.fn("SyncHandlers.pull")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .pull(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "acquireSnapshot",
        Effect.fn("SyncHandlers.acquireSnapshot")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .acquireSnapshot(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "readSnapshotPart",
        Effect.fn("SyncHandlers.readSnapshotPart")(function* ({ params }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .readSnapshotPart(syncActor(identity), params.snapshotId, params.partNumber)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "mintLiveTicket",
        Effect.fn("SyncHandlers.mintLiveTicket")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .mintLiveTicket(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      );
  }),
);
