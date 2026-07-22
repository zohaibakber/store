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

export class SyncEntityChange extends Schema.Class<SyncEntityChange>("SyncEntityChange")({
  entity: SyncEntity,
  action: SyncAction,
  entityId: Schema.String,
  rowVersion: Schema.Number,
  row: Schema.Unknown,
}) {}

// Bounds keep a single sync request within Hyperdrive's 60s query/transaction
// limit: every operation and its changes are applied sequentially in one
// transaction (see apps/server/src/sync/database.ts), so batch size is capped
// well above the client's 100-operation push batch (packages/persistence/src/sync-engine.ts).
const MAX_OPERATIONS_PER_REQUEST = 200;
const MAX_CHANGES_PER_OPERATION = 200;

// payloadHash is the SHA-256 hex digest of canonical stable-key JSON for every
// field below except payloadHash itself. Both peers validate the claimed hash.
export class SyncOperation extends Schema.Class<SyncOperation>("SyncOperation")({
  operationId: Schema.String,
  organizationId: Schema.String,
  deviceId: Schema.String,
  actorUserId: Schema.String,
  clientSequence: Schema.Number,
  occurredAt: Schema.Number,
  payloadHash: Schema.String,
  changes: Schema.Array(SyncEntityChange).check(Schema.isMaxLength(MAX_CHANGES_PER_OPERATION)),
}) {}

export class SyncRequest extends Schema.Class<SyncRequest>("SyncRequest")({
  organizationId: Schema.String,
  deviceId: Schema.String,
  cursor: Schema.Number,
  operations: Schema.Array(SyncOperation).check(Schema.isMaxLength(MAX_OPERATIONS_PER_REQUEST)),
}) {}

export class SyncAck extends Schema.Class<SyncAck>("SyncAck")({
  operationId: Schema.String,
  status: Schema.Literals(["applied", "duplicate"]),
  cursor: Schema.Number,
}) {}

export class SyncServerChange extends Schema.Class<SyncServerChange>("SyncServerChange")({
  cursor: Schema.Number,
  operationId: Schema.String,
  changedAt: Schema.Number,
  change: SyncEntityChange,
}) {}

export class SyncResponse extends Schema.Class<SyncResponse>("SyncResponse")({
  organizationId: Schema.String,
  cursor: Schema.Number,
  hasMore: Schema.Boolean,
  acknowledgements: Schema.Array(SyncAck),
  changes: Schema.Array(SyncServerChange),
}) {}

export type SyncPhase = "local-only" | "idle" | "syncing" | "error";

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly configured: boolean;
  readonly lastSyncedAt: number | null;
  readonly message: string;
}
