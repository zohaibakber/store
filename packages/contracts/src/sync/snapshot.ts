import * as Schema from "effect/Schema";

import {
  MAX_SYNC_IDENTIFIER_LENGTH,
  OrgCommitSequence,
  SyncEpoch,
  SyncLogChange,
  SyncSchemaVersion,
  SyncSubscription,
} from "./protocol";
import { SyncEntity } from "./schema";

export const MAX_SNAPSHOT_PART_ROWS = 500;

export const SnapshotId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
).pipe(Schema.brand("SnapshotId"));
export type SnapshotId = typeof SnapshotId.Type;

export const SnapshotPartHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
export type SnapshotPartHash = typeof SnapshotPartHash.Type;

export const SnapshotRow = Schema.Struct({
  entity: SyncLogChange.fields.entity,
  entityId: SyncLogChange.fields.entityId,
  rowVersion: SyncLogChange.fields.rowVersion,
  row: SyncLogChange.fields.row,
});
export type SnapshotRow = typeof SnapshotRow.Type;

export const SnapshotEntityCount = Schema.Struct({
  entity: SyncEntity,
  rowCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type SnapshotEntityCount = typeof SnapshotEntityCount.Type;

export const SnapshotPartRef = Schema.Struct({
  partNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  objectKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
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
});
export type AcquireSnapshotRequest = typeof AcquireSnapshotRequest.Type;

export const AcquireSnapshotResult = Schema.TaggedUnion({
  ready: {
    manifest: SnapshotManifest,
  },
  building: {
    snapshotId: SnapshotId,
    retryAfterMillis: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  },
});
export type AcquireSnapshotResult = typeof AcquireSnapshotResult.Type;
