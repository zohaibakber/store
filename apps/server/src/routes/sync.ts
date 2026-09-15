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
import { SyncAuthority, SyncUnavailableError } from "../inventory/sync-authority";

const body = (code: string, message: string) => ({ error: { code, message } });

const syncProtocolError = (error: SyncProtocolError) => {
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
      return SyncConflict.make(body(error.code, error.message));
    default:
      return SyncBadRequest.make(body(error.code, error.message));
  }
};

const mapSyncError = (error: SyncProtocolError | SyncUnavailableError) => {
  if (error._tag === "SyncUnavailableError") {
    return SyncServiceUnavailable.make(body("SYNC_NOT_PROVISIONED", error.message));
  }
  return syncProtocolError(error);
};

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
            .registerReplica(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "submitCommand",
        Effect.fn("SyncHandlers.submitCommand")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .submitCommand(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "getReceipt",
        Effect.fn("SyncHandlers.getReceipt")(function* ({ params }) {
          const identity = yield* CurrentOrganization;
          const receipt = yield* authority
            .getReceipt(
              { organizationId: identity.organizationId, userId: identity.user.id },
              params.operationId,
            )
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
            .pull({ organizationId: identity.organizationId, userId: identity.user.id }, payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      );
  }),
);
