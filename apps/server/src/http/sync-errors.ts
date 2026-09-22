import type { SyncProtocolError } from "@store/contracts";
import {
  SyncBadRequest,
  SyncConflict,
  SyncForbidden,
  SyncServiceUnavailable,
} from "@store/contracts/sync/http-errors";

import type { SyncUnavailableError } from "../inventory/sync-authority";

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
