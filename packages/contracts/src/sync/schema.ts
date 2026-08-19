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
export const SYNC_PROTOCOL_VERSION = 2 as const;

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
  // Optional while protocol-v1 desktop builds remain supported. New clients
  // always send v2 and the server always answers with a v2 envelope.
  protocolVersion: Schema.optionalKey(Schema.Literal(SYNC_PROTOCOL_VERSION)),
  organizationId: Schema.String,
  deviceId: Schema.String,
  clientPlatform: Schema.optionalKey(Schema.String),
  clientVersion: Schema.optionalKey(Schema.String),
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
  protocolVersion: Schema.Literal(SYNC_PROTOCOL_VERSION),
  organizationId: Schema.String,
  /** Compatibility alias for nextCursor used by protocol-v1 clients. */
  cursor: Schema.Number,
  nextCursor: Schema.Number,
  headCursor: Schema.Number,
  hasMore: Schema.Boolean,
  acknowledgements: Schema.Array(SyncAck),
  changes: Schema.Array(SyncServerChange),
});
export interface SyncResponse extends Schema.Schema.Type<typeof SyncResponse> {}

export type SyncPhase =
  | "local-only"
  | "starting"
  | "offline"
  | "connecting"
  | "live"
  | "idle"
  | "syncing"
  | "blocked"
  | "error";

type SyncHealth = {
  readonly lastSyncedAt: number | null;
  readonly message: string;
  readonly pendingOperations: number;
  readonly oldestPendingAt: number | null;
  readonly lastError: string | null;
  readonly quarantined: boolean;
};

export type SyncStatus =
  | ({ readonly phase: "local-only" } & SyncHealth)
  | ({ readonly phase: Exclude<SyncPhase, "local-only"> } & SyncHealth);

export const syncConfigured = (status: SyncStatus): boolean => status.phase !== "local-only";
