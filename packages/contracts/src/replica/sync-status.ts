import * as Schema from "effect/Schema";

import { CommandStatus } from "../sync/replica-model";
import { SyncEntity } from "../sync/schema";
import { MAX_REJECTED_ACTIVITY_ROWS, MAX_REJECTED_COMMAND_TARGETS } from "./limits";

export const SyncTransfer = Schema.Struct({
  partsDone: Schema.Natural,
  partsTotal: Schema.Natural,
});
export type SyncTransfer = typeof SyncTransfer.Type;

const auth = Schema.optionalKey(Schema.Literal("refreshing"));

export const SyncHealth = Schema.TaggedUnion({
  running: {
    syncing: Schema.optionalKey(Schema.Boolean),
    transfer: Schema.optionalKey(SyncTransfer),
    auth,
  },
  storageError: { message: Schema.String, auth },
  updateRequired: { message: Schema.String, auth },
  recoveryRequired: { message: Schema.String, auth },
});
export type SyncHealth = typeof SyncHealth.Type;

export const RejectedCommandTarget = Schema.Struct({ entity: SyncEntity, id: Schema.String });
export type RejectedCommandTarget = typeof RejectedCommandTarget.Type;

export const RejectedCommand = Schema.Struct({
  operationId: Schema.String,
  clientSequence: Schema.String,
  createdAt: Schema.Number,
  command: Schema.Literals(["issueInvoice", "catalogWrite"]),
  code: Schema.String,
  message: Schema.String,
  targets: Schema.Array(RejectedCommandTarget).check(
    Schema.isMaxLength(MAX_REJECTED_COMMAND_TARGETS),
  ),
  productId: Schema.NullOr(Schema.String),
});
export type RejectedCommand = typeof RejectedCommand.Type;

export const InventorySyncActivity = Schema.Struct({
  pendingCount: Schema.Natural,
  rejectedCount: Schema.Natural,
  rejected: Schema.Array(RejectedCommand).check(Schema.isMaxLength(MAX_REJECTED_ACTIVITY_ROWS)),
  lastCaughtUpAt: Schema.NullOr(Schema.Number),
  firstSyncPending: Schema.Boolean,
  lowestActiveSchemaVersion: Schema.NullOr(Schema.Number),
});
export type InventorySyncActivity = typeof InventorySyncActivity.Type;

export const ReplicaSyncActivity = Schema.Struct({
  statuses: Schema.Array(CommandStatus),
  activity: InventorySyncActivity,
});
export type ReplicaSyncActivity = typeof ReplicaSyncActivity.Type;
