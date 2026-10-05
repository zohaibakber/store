import { InventorySubsetSummary, InventorySubsetSummarySpec } from "@store/client-db/subset-spec";
import { LicenceState, ShopId } from "@store/contracts";
import { Stamp } from "@store/contracts/replica";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Transferable from "effect/workers/Transferable";

const PERMANENT_STREAMS = 1;
const CONTROL_SLOTS = 8;
const FINITE_DATABASE_OPERATIONS = 2;
export const WORKER_RPC_CONCURRENCY =
  PERMANENT_STREAMS + CONTROL_SLOTS + FINITE_DATABASE_OPERATIONS;

const READER_CONTROL_SLOTS = 2;
const READER_FINITE_READS = 2;
export const READER_RPC_CONCURRENCY = READER_CONTROL_SLOTS + READER_FINITE_READS;

const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const ReplicaWorkspaceToken = NonEmptyString;

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

export const ReplicaWorkerBoot = Schema.Struct({
  replicaId: NonEmptyString,
  databasePath: Schema.String,
});

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
  Rpc.make("Commits", { success: ReplicaCommitNotice, stream: true }),
  Rpc.make("SetLicence", { payload: { state: LicenceState }, error: ReplicaWorkerFailure }),
  Rpc.make("DatabaseShop", {
    success: Schema.Struct({ shopId: Schema.NullOr(ShopId) }),
    error: ReplicaWorkerFailure,
  }),
);
