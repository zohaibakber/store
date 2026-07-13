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
  changes: Schema.Array(SyncEntityChange),
}) {}

export class SyncRequest extends Schema.Class<SyncRequest>("SyncRequest")({
  organizationId: Schema.String,
  deviceId: Schema.String,
  cursor: Schema.Number,
  operations: Schema.Array(SyncOperation),
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
