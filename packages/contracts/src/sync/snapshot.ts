import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { PositiveInt, Sha256Hex, SyncIdentifier } from "../schema-primitives";
import {
  OrgCommitSequence,
  PartitionDigestVersion,
  SyncEpoch,
  SyncLogChange,
  SyncSchemaVersion,
  SyncSubscription,
} from "./protocol";
import { SyncEntity } from "./schema";

export const MAX_SNAPSHOT_PART_ROWS = 2_000;

export const MAX_SNAPSHOT_PART_BYTES = 786_432;

export const SnapshotId = SyncIdentifier.pipe(Schema.brand("SnapshotId"));
export type SnapshotId = typeof SnapshotId.Type;

export const SnapshotPartHash = Sha256Hex;
export type SnapshotPartHash = typeof SnapshotPartHash.Type;

export const SnapshotRow = SyncLogChange.mapFields(Struct.omit(["action"]));
export type SnapshotRow = typeof SnapshotRow.Type;

const SnapshotEntityCount = Schema.Struct({
  entity: SyncEntity,
  rowCount: Schema.Natural,
});

const SnapshotPartRef = Schema.Struct({
  partNumber: PositiveInt,
  byteLength: Schema.Natural,
  sha256: SnapshotPartHash,
});

export const SnapshotManifest = Schema.Struct({
  snapshotId: SnapshotId,
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  schemaVersion: SyncSchemaVersion,
  horizon: OrgCommitSequence,
  parts: Schema.Array(SnapshotPartRef),
  entityCounts: Schema.Array(SnapshotEntityCount),
  digestVersion: PartitionDigestVersion,
});
export type SnapshotManifest = typeof SnapshotManifest.Type;

export const SnapshotPartPayload = Schema.Struct({
  snapshotId: SnapshotId,
  partNumber: SnapshotPartRef.fields.partNumber,
  rows: Schema.Array(SnapshotRow),
});
export type SnapshotPartPayload = typeof SnapshotPartPayload.Type;

export const AcquireSnapshotRequest = Schema.Struct({
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  replicaId: Schema.optionalKey(SyncIdentifier),
});
export type AcquireSnapshotRequest = typeof AcquireSnapshotRequest.Type;

export const AcquireSnapshotResult = Schema.TaggedStruct("ready", {
  manifest: SnapshotManifest,
});
export type AcquireSnapshotResult = typeof AcquireSnapshotResult.Type;

export const SNAPSHOT_LEASE_LIFETIME_MILLIS = 15 * 60_000;
