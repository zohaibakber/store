import * as Schema from "effect/Schema";

export const SyncEntity = Schema.Literals([
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
]);
export type SyncEntity = typeof SyncEntity.Type;

export const SyncAction = Schema.Literals(["upsert", "delete"]);
export type SyncAction = typeof SyncAction.Type;

export const SyncEntityChange = Schema.Struct({
  entity: SyncEntity,
  action: SyncAction,
  entityId: Schema.String,
  rowVersion: Schema.Number,
  row: Schema.Unknown,
});
export interface SyncEntityChange extends Schema.Schema.Type<typeof SyncEntityChange> {}

export const MAX_SYNC_OPERATIONS_PER_REQUEST = 100;
export const MAX_SYNC_CHANGES_PER_OPERATION = 1_000;
export const MAX_SYNC_CHANGES_PER_REQUEST = 1_000;

export const SyncOperation = Schema.Struct({
  operationId: Schema.String,
  organizationId: Schema.String,
  deviceId: Schema.String,
  actorUserId: Schema.String,
  clientSequence: Schema.Number,
  occurredAt: Schema.Number,
  payloadHash: Schema.String,
  changes: Schema.Array(SyncEntityChange).check(Schema.isMaxLength(MAX_SYNC_CHANGES_PER_OPERATION)),
});
export interface SyncOperation extends Schema.Schema.Type<typeof SyncOperation> {}

export const SyncRequest = Schema.Struct({
  organizationId: Schema.String,
  deviceId: Schema.String,
  cursor: Schema.Number,
  operations: Schema.Array(SyncOperation).check(
    Schema.isMaxLength(MAX_SYNC_OPERATIONS_PER_REQUEST),
  ),
});
export interface SyncRequest extends Schema.Schema.Type<typeof SyncRequest> {}

export const SyncAck = Schema.Struct({
  operationId: Schema.String,
  status: Schema.Literals(["applied", "duplicate"]),
  cursor: Schema.Number,
});
export interface SyncAck extends Schema.Schema.Type<typeof SyncAck> {}

export const SyncServerChange = Schema.Struct({
  cursor: Schema.Number,
  operationId: Schema.String,
  changedAt: Schema.Number,
  change: SyncEntityChange,
});
export interface SyncServerChange extends Schema.Schema.Type<typeof SyncServerChange> {}

export const SyncResponse = Schema.Struct({
  organizationId: Schema.String,
  cursor: Schema.Number,
  hasMore: Schema.Boolean,
  acknowledgements: Schema.Array(SyncAck),
  changes: Schema.Array(SyncServerChange),
});
export interface SyncResponse extends Schema.Schema.Type<typeof SyncResponse> {}

export type SyncPhase = "local-only" | "idle" | "syncing" | "error";

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly configured: boolean;
  readonly lastSyncedAt: number | null;
  readonly message: string;
  readonly pendingOperations: number;
  readonly oldestPendingAt: number | null;
  readonly lastError: string | null;
  readonly quarantined: boolean;
}
