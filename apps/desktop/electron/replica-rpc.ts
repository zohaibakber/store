import {
  InventorySubsetBatch,
  InventorySubsetSpec,
  InventorySubsetSummary,
  InventorySubsetSummarySpec,
} from "@store/client-db/subset-spec";
import {
  CommandStatus,
  EnqueueCommandRequest,
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  ReplicaInsightsFacts,
  ReplicaInsightsWindow,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

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

export const ReplicaReadSubsetInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  requestId: NonEmptyString,
  spec: InventorySubsetSpec,
});

export const ReplicaReadBatchInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  requestId: NonEmptyString,
  specs: InventorySubsetBatch,
});

export const ReplicaCancelReadInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  requestId: NonEmptyString,
});

export const ReplicaSummarizeSubsetInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  spec: InventorySubsetSummarySpec,
});

export const ReplicaReadInsightsInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  window: ReplicaInsightsWindow,
});

export const ReplicaEnqueueInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  request: EnqueueCommandRequest,
});

export const ReplicaCommandStatusInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  operationId: NonEmptyString,
});

const FilePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096));

export const ReplicaCatalogCounts = Schema.Struct({
  products: NonNegativeInteger,
  sales: NonNegativeInteger,
});

export const ReplicaWorkerBoot = Schema.Union([
  Schema.Struct({ ...LocalReplicaIdentity.fields, databasePath: Schema.String }),
  Schema.Struct({
    ...RemoteReplicaIdentity.fields,
    databasePath: Schema.String,
    apiBaseUrl: Schema.String,
  }),
]);

export const ReplicaReaderBoot = Schema.Struct({ databasePath: Schema.String });

const ReplicaCommitStamp = Schema.Struct({
  generationId: NonEmptyString,
  localCommitVersion: NonNegativeInteger,
});

export const ReplicaCommitNotice = Schema.Struct({
  ...ReplicaCommitStamp.fields,
  touchedEntities: Schema.Array(Schema.String),
  touchedKeys: Schema.Array(Schema.String),
  fullInvalidation: Schema.optionalKey(Schema.Boolean),
  overflowedEntities: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ReplicaSyncHealth = Schema.Union([
  Schema.TaggedStruct("running", { syncing: Schema.optionalKey(Schema.Boolean) }),
  Schema.TaggedStruct("storageError", { message: Schema.String }),
  Schema.TaggedStruct("updateRequired", { message: Schema.String }),
  Schema.TaggedStruct("recoveryRequired", {
    message: Schema.String,
    retryable: Schema.optionalKey(Schema.Boolean),
  }),
]);

const ReplicaIpcRow = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Null]),
);

const ReplicaSubsetRows = Schema.Struct({
  stamp: ReplicaCommitStamp,
  rows: Schema.Array(ReplicaIpcRow),
});

const ReplicaBatchRows = Schema.Struct({
  stamp: ReplicaCommitStamp,
  reads: Schema.Array(Schema.Array(ReplicaIpcRow)),
});

const MAX_PROXY_TIMEOUT_MILLIS = 120_000;

export const ProxyFetchRequest = Schema.Struct({
  requestId: NonEmptyString,
  method: Schema.Literals(["GET", "POST"]),
  pathname: Schema.String,
  bodyText: Schema.NullOr(Schema.String),
  timeoutMillis: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(MAX_PROXY_TIMEOUT_MILLIS),
  ),
});

export const ProxyFetchResult = Schema.Struct({
  ok: Schema.Boolean,
  status: NonNegativeInteger,
  bodyText: Schema.String,
  retryAfter: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
});
export type ProxyFetchResult = typeof ProxyFetchResult.Type;

export const AccessTokenRequest = Schema.Struct({
  requestId: NonEmptyString,
  force: Schema.Boolean,
});

export const AccessTokenResult = Schema.NullOr(Schema.String.check(Schema.isMaxLength(8_192)));
export type AccessTokenResult = typeof AccessTokenResult.Type;

export class ReplicaWorkerFailure extends Schema.TaggedError<ReplicaWorkerFailure>()(
  "ReplicaWorkerFailure",
  { message: Schema.String },
) {}

const EngineRpc = Rpc.make("Engine", { success: Schema.Literals(["sqlite", "unavailable"]) });

export const ReplicaReaderRpcs = RpcGroup.make(
  EngineRpc,
  Rpc.make("ReadSubset", {
    payload: { spec: InventorySubsetSpec },
    success: ReplicaSubsetRows,
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("ReadBatch", {
    payload: { specs: InventorySubsetBatch },
    success: ReplicaBatchRows,
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("SummarizeSubset", {
    payload: { spec: InventorySubsetSummarySpec },
    success: Schema.Struct({ stamp: ReplicaCommitStamp, summary: InventorySubsetSummary }),
    error: ReplicaWorkerFailure,
  }),
);

export const ReplicaWorkerRpcs = RpcGroup.make(
  EngineRpc,
  Rpc.make("Stamp", { success: ReplicaCommitStamp, error: ReplicaWorkerFailure }),
  Rpc.make("ReadInsights", {
    payload: { window: ReplicaInsightsWindow },
    success: Schema.Struct({ stamp: ReplicaCommitStamp, facts: ReplicaInsightsFacts }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("ReadOutboxStatuses", {
    success: Schema.Array(CommandStatus),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("EnqueueCommand", {
    payload: { request: EnqueueCommandRequest },
    success: Schema.Struct({
      operationId: NonEmptyString,
      status: CommandStatus,
      stamp: ReplicaCommitStamp,
    }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("ReadCommandStatus", {
    payload: { operationId: NonEmptyString },
    success: Schema.NullOr(CommandStatus),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("SetForeground", {
    payload: { visible: Schema.Boolean },
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("WakeSyncUpload", {
    success: Schema.Struct({ drained: Schema.Boolean, drainCount: NonNegativeInteger }),
    error: ReplicaWorkerFailure,
  }),
  Rpc.make("BackUp", {
    payload: { destinationPath: FilePath },
    success: Schema.Struct({ bytes: NonNegativeInteger }),
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
  Rpc.make("Commits", { success: ReplicaCommitNotice, stream: true }),
  Rpc.make("SyncHealth", { success: ReplicaSyncHealth, stream: true }),
  Rpc.make("ProxyRequests", { success: ProxyFetchRequest, stream: true }),
  Rpc.make("ProxyRespond", {
    payload: { requestId: NonEmptyString, result: ProxyFetchResult },
  }),
  Rpc.make("AccessTokenRequests", { success: AccessTokenRequest, stream: true }),
  Rpc.make("AccessTokenRespond", {
    payload: { requestId: NonEmptyString, token: AccessTokenResult },
  }),
);
