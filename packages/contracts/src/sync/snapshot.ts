import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { PositiveInt, Sha256Hex, SyncIdentifier } from "../schema-primitives";
import {
  OrgCommitSequence,
  SyncEpoch,
  SyncLogChange,
  SyncSchemaVersion,
  SyncSubscription,
} from "./protocol";
import { SyncEntity } from "./schema";

export const MAX_SNAPSHOT_PART_ROWS = 500;

export const SnapshotId = SyncIdentifier.pipe(Schema.brand("SnapshotId"));
export type SnapshotId = typeof SnapshotId.Type;

export const SnapshotPartHash = Sha256Hex;
export type SnapshotPartHash = typeof SnapshotPartHash.Type;

export const SnapshotRow = SyncLogChange.mapFields(Struct.omit(["action"]));
export type SnapshotRow = typeof SnapshotRow.Type;

export const SnapshotEntityCount = Schema.Struct({
  entity: SyncEntity,
  rowCount: Schema.Natural,
});
export type SnapshotEntityCount = typeof SnapshotEntityCount.Type;

export const SnapshotPartRef = Schema.Struct({
  partNumber: PositiveInt,
  objectKey: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
  byteLength: Schema.Natural,
  sha256: SnapshotPartHash,
});
export type SnapshotPartRef = typeof SnapshotPartRef.Type;

export const SnapshotManifest = Schema.Struct({
  snapshotId: SnapshotId,
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  schemaVersion: SyncSchemaVersion,
  horizon: OrgCommitSequence,
  parts: Schema.Array(SnapshotPartRef),
  entityCounts: Schema.Array(SnapshotEntityCount),
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

export const AcquireSnapshotResult = Schema.TaggedUnion({
  ready: {
    manifest: SnapshotManifest,
  },
  building: {
    snapshotId: SnapshotId,
    retryAfterMillis: PositiveInt,
  },
});
export type AcquireSnapshotResult = typeof AcquireSnapshotResult.Type;
