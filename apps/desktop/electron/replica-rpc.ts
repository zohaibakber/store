import { InventorySubsetSummary, InventorySubsetSummarySpec } from "@store/client-db/subset-spec";
import {
  DeviceLabel,
  ImportId,
  ImportPartNumber,
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  PartitionDigest,
  PositiveInt,
} from "@store/contracts";
import { Stamp, SyncHealth } from "@store/contracts/replica";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Transferable from "effect/workers/Transferable";

const PERMANENT_STREAMS = 2;
const CONTROL_SLOTS = 8;
const FINITE_DATABASE_OPERATIONS = 2;
export const WORKER_RPC_CONCURRENCY =
  PERMANENT_STREAMS + CONTROL_SLOTS + FINITE_DATABASE_OPERATIONS;

const READER_CONTROL_SLOTS = 2;
const READER_FINITE_READS = 2;
export const READER_RPC_CONCURRENCY = READER_CONTROL_SLOTS + READER_FINITE_READS;

const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const ReplicaWorkspaceToken = NonEmptyString;

const LocalReplicaIdentity = Schema.Struct({
  authority: Schema.Literal("local"),
  organizationId: Schema.Literal(LOCAL_ORGANIZATION_ID),
  userId: Schema.Literal(LOCAL_USER_ID),
  replicaId: NonEmptyString,
});

const RemoteReplicaIdentity = Schema.Struct({
  authority: Schema.Literal("remote"),
  organizationId: NonEmptyString,
  userId: NonEmptyString,
  replicaId: NonEmptyString,
});

export const ReplicaOpenInput = Schema.Union([LocalReplicaIdentity, RemoteReplicaIdentity]);

export type ReplicaAuthority = (typeof ReplicaOpenInput.Type)["authority"];

const FilePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096));

const ReplicaCatalogCounts = Schema.Struct({
  products: Schema.Natural,
  sales: Schema.Natural,
  purchaseOrders: Schema.Natural,
});

export const catalogCountsOf = (summary: typeof ReplicaCatalogCounts.Type) => ({
  products: summary.products,
  sales: summary.sales,
  purchaseOrders: summary.purchaseOrders,
});

export const RESTORE_LOCAL_ONLY = "Only the workspace on this device can be restored from a file.";

export const ReplicaPublishSummary = Schema.Struct({
  importId: ImportId,
  ...ReplicaCatalogCounts.fields,
  rows: Schema.Natural,
  outstanding: Schema.Natural,
});

export const ReplicaPublishSeal = Schema.Struct({
  partCount: ImportPartNumber,
  digest: PartitionDigest,
  digestVersion: PositiveInt,
});

const ReplicaPublishProgress = Schema.Union([
  Schema.TaggedStruct("staged", { partNumber: ImportPartNumber, rowCount: Schema.Natural }),
  Schema.TaggedStruct("sealed", ReplicaPublishSeal.fields),
]);

const ReplicaPublishCommit = Schema.Union([
  Schema.TaggedStruct("committed", {}),
  Schema.TaggedStruct("refused", { code: Schema.String, message: Schema.String }),
  Schema.TaggedStruct("unconfirmed", { message: Schema.String }),
]);

const ReplicaPublishStatus = Schema.Union([
  Schema.TaggedStruct("committed", {}),
  Schema.TaggedStruct("other", { message: Schema.String }),
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("unconfirmed", { message: Schema.String }),
]);

export const ReplicaWorkerBoot = Schema.Union([
  Schema.Struct({ ...LocalReplicaIdentity.fields, databasePath: Schema.String }),
  Schema.Struct({
    ...RemoteReplicaIdentity.fields,
    databasePath: Schema.String,
    apiBaseUrl: Schema.String,
    deviceLabel: Schema.optionalKey(DeviceLabel),
  }),
]);

export const ReplicaReaderBoot = Schema.Struct({ databasePath: Schema.String });

export const ReplicaCommitStamp = Stamp;

export const commitStampOf = (stamp: typeof ReplicaCommitStamp.Type) => ({
  generationId: stamp.generationId,
  localCommitVersion: stamp.localCommitVersion,
});

export const ReplicaCommitNotice = Schema.Struct({
  ...ReplicaCommitStamp.fields,
  touchedEntities: Schema.Array(Schema.String),
  touchedKeys: Schema.Array(Schema.String),
  fullInvalidation: Schema.optionalKey(Schema.Boolean),
  overflowedEntities: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ReplicaSyncHealth = SyncHealth;

const AccessToken = Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(8_192)));

export class ReplicaWorkerFailure extends Schema.TaggedError<ReplicaWorkerFailure>()(
  "ReplicaWorkerFailure",
  { message: Schema.String },
) {}

const EngineRpc = Rpc.make("Engine", { success: Schema.Literals(["sqlite", "unavailable"]) });

export const AttachRendererRpc = Rpc.make("AttachRenderer", {
  payload: { port: Transferable.MessagePort },
});

export const ReplicaReaderRpcs = RpcGroup.make(
  EngineRpc,
  AttachRendererRpc,
  Rpc.make("SummarizeSubset", {
    payload: { spec: InventorySubsetSummarySpec },
    success: Schema.Struct({ stamp: ReplicaCommitStamp, summary: InventorySubsetSummary }),
    error: ReplicaWorkerFailure,
  }),
);

export const ReplicaWorkerRpcs = RpcGroup.make(
  EngineRpc,
  AttachRendererRpc,
  Rpc.make("Stamp", { success: ReplicaCommitStamp, error: ReplicaWorkerFailure }),
  Rpc.make("SetForeground", {
    payload: { visible: Schema.Boolean },
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("BackUp", {
    payload: { destinationPath: FilePath },
    success: Schema.Struct({ bytes: Schema.Natural }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("StageRestore", {
    payload: { sourcePath: FilePath, stagedPath: FilePath },
    success: Schema.Struct({ current: ReplicaCatalogCounts, backup: ReplicaCatalogCounts }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("ReleaseForRestore", {
    payload: { stagedPath: FilePath },
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("PublishSummary", {
    payload: { sourcePath: FilePath },
    success: ReplicaPublishSummary,
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("PublishStage", {
    payload: { sourcePath: FilePath, importId: ImportId },
    success: ReplicaPublishProgress,
    error: ReplicaWorkerFailure,
    stream: true,
  }),
  Rpc.make("PublishCommit", {
    payload: { sourcePath: FilePath, importId: ImportId, seal: ReplicaPublishSeal },
    success: ReplicaPublishCommit,
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("PublishStatus", {
    payload: { importId: ImportId },
    success: ReplicaPublishStatus,
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("Commits", { success: ReplicaCommitNotice, stream: true }),
  Rpc.make("SyncHealth", { success: ReplicaSyncHealth, stream: true }),
  Rpc.make("SetAccessToken", { payload: { token: Schema.NullOr(AccessToken) } }),
);
