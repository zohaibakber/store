import type { SyncProtocolCode, SyncProtocolError } from "@store/contracts";
import {
  SyncBadRequest,
  SyncConflict,
  SyncForbidden,
  SyncServiceUnavailable,
} from "@store/contracts/sync/api";
import * as Effect from "effect/Effect";

import type { InventoryDatabaseError, InventoryError } from "../inventory/errors";
import { publicError } from "./errors";

export const SYNC_STATUS = {
  ORGANIZATION_MISMATCH: 403,
  REPLICA_OWNED_BY_OTHER: 403,
  OPERATION_ID_REUSED: 409,
  INSUFFICIENT_STOCK: 409,
  INVOICE_IDENTITY_CONFLICT: 409,
  ENTITY_CONFLICT: 409,
  ENTITY_RELATION_INVALID: 409,
  REPLICA_SEQUENCE_GAP: 409,
  EPOCH_MISMATCH: 409,
  REPLICA_UNKNOWN: 409,
  SNAPSHOT_REQUIRED: 409,
  SNAPSHOT_UNAVAILABLE: 409,
  INCARNATION_MISMATCH: 409,
  INVALID_OPERATION: 400,
  ENTITY_WRITE_FAILED: 400,
  COMMAND_IDENTITY_MISMATCH: 400,
  INVALID_PAYLOAD_HASH: 400,
  SCHEMA_VERSION_UNSUPPORTED: 400,
  SUPPLIER_HAS_ORDERS: 400,
  PURCHASE_ORDER_TRANSITION_INVALID: 400,
  PURCHASE_ORDER_NOT_OPEN: 400,
  PURCHASE_ORDER_NOT_DRAFT: 400,
  PURCHASE_ORDER_HAS_ITEMS: 400,
  PURCHASE_ORDER_ITEM_QUANTITY_INVALID: 400,
  PURCHASE_ORDER_ITEM_RECEIVED: 400,
  PURCHASE_ORDER_RECEIPT_PRODUCT_MISMATCH: 400,
  REPLICA_SCHEMA_OUTDATED: 400,
} as const satisfies Record<SyncProtocolCode, 400 | 403 | 409>;

const syncProtocolHttpError = (error: SyncProtocolError) => {
  const body = publicError(error.code, error.message);
  switch (SYNC_STATUS[error.code]) {
    case 403:
      return SyncForbidden.make(body);
    case 409:
      return SyncConflict.make(body);
    case 400:
      return SyncBadRequest.make(body);
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
