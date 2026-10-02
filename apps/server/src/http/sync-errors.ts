import type { SyncProtocolError } from "@store/contracts";
import {
  SyncBadRequest,
  SyncConflict,
  SyncForbidden,
  SyncServiceUnavailable,
} from "@store/contracts/sync/http-errors";
import * as Effect from "effect/Effect";

import type { InventoryDatabaseError, InventoryError } from "../inventory/errors";
import { publicError } from "./errors";

const syncProtocolHttpError = (error: SyncProtocolError) => {
  switch (error.code) {
    case "ORGANIZATION_MISMATCH":
    case "REPLICA_OWNED_BY_OTHER":
      return SyncForbidden.make(publicError(error.code, error.message));
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
    case "INCARNATION_MISMATCH":
      return SyncConflict.make(publicError(error.code, error.message));
    default:
      return SyncBadRequest.make(publicError(error.code, error.message));
  }
};

const syncUnavailable = SyncServiceUnavailable.make(
  publicError(
    "SYNC_UNAVAILABLE",
    "Organization sync is temporarily unavailable. Try again shortly.",
  ),
);

const syncDatabaseFailure = (error: InventoryDatabaseError) =>
  Effect.logError("inventory.database_failed", error.cause ?? error.message).pipe(
    Effect.annotateLogs({ detail: error.message }),
    Effect.andThen(Effect.fail(syncUnavailable)),
  );

type SyncHttpError = SyncBadRequest | SyncForbidden | SyncConflict | SyncServiceUnavailable;

export const failWithSyncHttpError = (
  error: InventoryError,
): Effect.Effect<never, SyncHttpError> =>
  error._tag === "InventoryDatabaseError"
    ? syncDatabaseFailure(error)
    : Effect.fail(syncProtocolHttpError(error));
