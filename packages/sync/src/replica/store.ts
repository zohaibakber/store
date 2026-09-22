import type {
  CommandReceipt,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncProtocolError,
  SyncPullResult,
  SyncSubscription,
  SyncTransactionGroup,
} from "@store/contracts";
import type {
  CommandStatus,
  Committed,
  ReplicaCommitNotice,
  ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { ClaimNextUploadInput, UploadClaim } from "./commands";
import type {
  IndexedDbCorruptRecord,
  IndexedDbIdentityMismatch,
  IndexedDbQuotaExceeded,
  IndexedDbUnavailable,
  IndexedDbUpgradeBlocked,
  ReplicaStorageError,
} from "./errors";

export type { ClaimNextUploadInput };

export type AppliedCursor = {
  readonly appliedThrough: string;
  readonly repairRequired: boolean;
};

export type QueuedCommand = {
  readonly operationId: string;
  readonly status: CommandStatus;
};

export type ReplicaSyncCursor = {
  readonly epoch: string;
  readonly appliedCommitSequence: string;
};

export type ReplicaStoreError =
  | ReplicaStorageError
  | SyncProtocolError
  | IndexedDbUnavailable
  | IndexedDbQuotaExceeded
  | IndexedDbUpgradeBlocked
  | IndexedDbCorruptRecord
  | IndexedDbIdentityMismatch;

export type VerifyAuthorityInput = {
  readonly incarnation: string;
  readonly horizon: string;
};

export interface ReplicaStoreContract {
  readonly readSyncCursor: () => Effect.Effect<ReplicaSyncCursor, ReplicaStoreError>;

  readonly enqueueCommand: (
    envelope: SyncCommandEnvelope,
    createdAt: number,
  ) => Effect.Effect<Committed<QueuedCommand>, ReplicaStoreError>;

  readonly claimNextUpload: (
    input: ClaimNextUploadInput,
  ) => Effect.Effect<Committed<UploadClaim | undefined>, ReplicaStoreError>;

  readonly settleUploadClaim: (
    claimId: string,
    receipt: CommandReceipt,
  ) => Effect.Effect<Committed<CommandStatus | undefined>, ReplicaStoreError>;

  readonly releaseUploadClaim: (
    operationId: string,
    claimId: string,
  ) => Effect.Effect<Committed<CommandStatus | undefined>, ReplicaStoreError>;

  readonly recoverStaleUploadClaims: (
    staleBefore: number,
  ) => Effect.Effect<Committed<number>, ReplicaStoreError>;

  readonly applyRemotePage: (
    page: SyncPullResult,
  ) => Effect.Effect<Committed<AppliedCursor>, ReplicaStoreError>;

  readonly applyTransactionGroup: (
    group: SyncTransactionGroup,
  ) => Effect.Effect<Committed<string>, ReplicaStoreError>;

  readonly beginSnapshotImport: (
    manifest: SnapshotManifest,
  ) => Effect.Effect<void, ReplicaStoreError>;

  readonly importSnapshotPart: (
    manifest: SnapshotManifest,
    part: SnapshotPartPayload,
  ) => Effect.Effect<void, ReplicaStoreError>;

  readonly activateSnapshot: (
    snapshotId: SnapshotId,
  ) => Effect.Effect<Committed<void>, ReplicaStoreError>;

  readonly verifyAuthority: (input: VerifyAuthorityInput) => Effect.Effect<void, ReplicaStoreError>;

  readonly markCoverageRepair: (
    subscription: SyncSubscription,
  ) => Effect.Effect<void, ReplicaStoreError>;

  readonly readCommandStatus: (
    operationId: string,
  ) => Effect.Effect<CommandStatus | undefined, ReplicaStoreError>;

  readonly readStamp: () => Effect.Effect<ReplicaReadStamp, ReplicaStoreError>;

  readonly commits: Stream.Stream<ReplicaCommitNotice>;
}

export class ReplicaStore extends Context.Service<ReplicaStore, ReplicaStoreContract>()(
  "@store/sync/ReplicaStore",
) {}
