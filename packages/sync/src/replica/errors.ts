import { SyncProtocolCode, SyncProtocolError } from "@store/contracts";
import * as Schema from "effect/Schema";

export class ReplicaStorageError extends Schema.TaggedError<ReplicaStorageError>()(
  "ReplicaStorageError",
  {
    message: Schema.String,
  },
) {}

export class ReplicaCoverageRepairRequired extends Schema.TaggedError<ReplicaCoverageRepairRequired>()(
  "ReplicaCoverageRepairRequired",
  {
    subscription: Schema.String,
  },
) {}

export class IndexedDbUnavailable extends Schema.TaggedError<IndexedDbUnavailable>()(
  "IndexedDbUnavailable",
  { message: Schema.String },
) {}

export class IndexedDbQuotaExceeded extends Schema.TaggedError<IndexedDbQuotaExceeded>()(
  "IndexedDbQuotaExceeded",
  { message: Schema.String },
) {}

export class IndexedDbUpgradeBlocked extends Schema.TaggedError<IndexedDbUpgradeBlocked>()(
  "IndexedDbUpgradeBlocked",
  { message: Schema.String },
) {}

export class IndexedDbCorruptRecord extends Schema.TaggedError<IndexedDbCorruptRecord>()(
  "IndexedDbCorruptRecord",
  { message: Schema.String, store: Schema.String },
) {}

export class IndexedDbIdentityMismatch extends Schema.TaggedError<IndexedDbIdentityMismatch>()(
  "IndexedDbIdentityMismatch",
  {
    message: Schema.String,
    expectedOrganizationId: Schema.String,
    expectedUserId: Schema.String,
  },
) {}

export class SyncRecoveryRequired extends Schema.TaggedError<SyncRecoveryRequired>()(
  "SyncRecoveryRequired",
  {
    code: SyncProtocolCode,
    message: Schema.String,
  },
) {}

export type ReplicaStorageFailure =
  | ReplicaStorageError
  | IndexedDbUnavailable
  | IndexedDbQuotaExceeded
  | IndexedDbUpgradeBlocked
  | IndexedDbCorruptRecord
  | IndexedDbIdentityMismatch;

export type ReplicaStoreError = SyncProtocolError | ReplicaStorageFailure;

export const isReplicaStorageFailure = (cause: unknown): cause is ReplicaStorageFailure =>
  cause instanceof ReplicaStorageError ||
  cause instanceof IndexedDbUnavailable ||
  cause instanceof IndexedDbQuotaExceeded ||
  cause instanceof IndexedDbUpgradeBlocked ||
  cause instanceof IndexedDbCorruptRecord ||
  cause instanceof IndexedDbIdentityMismatch;

export const mapReplicaStoreFailure = (cause: unknown): ReplicaStoreError => {
  if (cause instanceof SyncProtocolError || isReplicaStorageFailure(cause)) return cause;
  return ReplicaStorageError.make({
    message: cause instanceof Error ? cause.message : "Replica storage failed.",
  });
};
