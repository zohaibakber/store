import { InventorySubsetSpec } from "@store/client-db/subset-spec";
import { CommandStatus, DecimalSequence, SyncCommandEnvelope } from "@store/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const ReplicaWorkspaceToken = NonEmptyString;

export const ReplicaOpenInput = Schema.Struct({
  organizationId: NonEmptyString,
  userId: NonEmptyString,
  replicaId: NonEmptyString,
});

export const ReplicaReadSubsetInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  spec: InventorySubsetSpec,
});

export const ReplicaEnqueueInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  envelope: SyncCommandEnvelope,
  createdAt: NonNegativeInteger,
});

export const ReplicaWorkerBoot = Schema.Struct({
  ...ReplicaOpenInput.fields,
  databasePath: Schema.String,
  apiBaseUrl: Schema.String,
});

const ReplicaCommitStamp = Schema.Struct({
  generationId: NonEmptyString,
  localCommitVersion: NonNegativeInteger,
});

export const ReplicaCommitNotice = Schema.Struct({
  ...ReplicaCommitStamp.fields,
  touchedEntities: Schema.Array(Schema.String),
  touchedKeys: Schema.Array(Schema.String),
});

export const ReplicaSyncHealth = Schema.Union([
  Schema.TaggedStruct("running", {}),
  Schema.TaggedStruct("storageError", { message: Schema.String }),
  Schema.TaggedStruct("recoveryRequired", { message: Schema.String }),
]);

const ReplicaSubsetRows = Schema.Struct({
  stamp: ReplicaCommitStamp,
  rows: Schema.Array(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Null])),
  ),
});

export const ProxyFetchRequest = Schema.Struct({
  requestId: NonEmptyString,
  method: Schema.Literals(["GET", "POST"]),
  pathname: Schema.String,
  bodyText: Schema.NullOr(Schema.String),
});

export const ProxyFetchResult = Schema.Struct({
  ok: Schema.Boolean,
  status: NonNegativeInteger,
  bodyText: Schema.String,
});
export type ProxyFetchResult = typeof ProxyFetchResult.Type;

export class ReplicaWorkerFailure extends Schema.TaggedError<ReplicaWorkerFailure>()(
  "ReplicaWorkerFailure",
  { message: Schema.String },
) {}

export const ReplicaWorkerRpcs = RpcGroup.make(
  Rpc.make("Open", {
    payload: ReplicaWorkerBoot,
    success: Schema.Literals(["sqlite", "unavailable"]),
  }),
  Rpc.make("Stamp", { success: ReplicaCommitStamp, error: ReplicaWorkerFailure }),
  Rpc.make("ReadSubset", {
    payload: { spec: InventorySubsetSpec },
    success: ReplicaSubsetRows,
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("ReadOutboxStatuses", {
    success: Schema.Array(CommandStatus),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("ReadCommandAllocation", {
    success: Schema.Struct({ epoch: DecimalSequence, nextClientSequence: DecimalSequence }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("EnqueueLocal", {
    payload: { envelope: SyncCommandEnvelope, createdAt: NonNegativeInteger },
    success: Schema.Struct({ changed: Schema.Boolean, status: NonEmptyString }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("WakeSyncUpload", {
    success: Schema.Struct({ drained: Schema.Boolean, drainCount: NonNegativeInteger }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("Commits", { success: ReplicaCommitNotice, stream: true }),
  Rpc.make("SyncHealth", { success: ReplicaSyncHealth, stream: true }),
  Rpc.make("ProxyRequests", { success: ProxyFetchRequest, stream: true }),
  Rpc.make("ProxyRespond", {
    payload: { requestId: NonEmptyString, result: ProxyFetchResult },
  }),
);
