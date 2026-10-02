import type {
  CommandReceipt,
  EnqueueCommandRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartPayload,
  SyncEntity,
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
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { ClaimNextUploadInput, UploadClaim } from "./commands";
import type { ReplicaStoreError } from "./errors";
import type { ReplicaAnnouncement, ReplicaRegistrationOutcome } from "./registration";

export type { ReplicaRegistrationOutcome, ReplicaStoreError };

export type AppliedCursor = {
  readonly appliedThrough: string;
  readonly repairRequired: boolean;
  readonly digestVerified?: boolean;
};

type PendingRowMarkEntry = {
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly operationId: string;
};

export type QueuedCommand = {
  readonly operationId: string;
  readonly status: CommandStatus;
  readonly stamp: ReplicaReadStamp;
};

type ReplicaSyncCursor = ReplicaAnnouncement & {
  readonly epoch: string;
  readonly appliedCommitSequence: string;
  readonly replicaId: string;
  readonly bootstrapped: boolean;
};

interface ReplicaRegistrationStore {
  readonly readSyncCursor: () => Effect.Effect<ReplicaSyncCursor, ReplicaStoreError>;

  readonly adoptRegistration: (
    authority: RegisterReplicaResult,
    registeredAt: number,
  ) => Effect.Effect<ReplicaRegistrationOutcome, ReplicaStoreError>;
}

interface ReplicaCommandStore {
  readonly enqueueCommand: (
    request: EnqueueCommandRequest,
  ) => Effect.Effect<Committed<QueuedCommand>, ReplicaStoreError>;

  readonly readCommandStatus: (
    operationId: string,
  ) => Effect.Effect<CommandStatus | undefined, ReplicaStoreError>;
}

interface ReplicaUploadClaimStore {
  readonly claimNextUpload: (
    input: ClaimNextUploadInput,
  ) => Effect.Effect<Committed<UploadClaim | undefined>, ReplicaStoreError>;

  readonly settleUploadClaim: (
    claimId: string,
    receipt: CommandReceipt,
  ) => Effect.Effect<Committed<CommandStatus | undefined>, ReplicaStoreError>;

  readonly settleUploadWithPage: (
    claimId: string,
    receipt: CommandReceipt,
    page: SyncPullResult,
  ) => Effect.Effect<Committed<AppliedCursor>, ReplicaStoreError>;

  readonly releaseUploadClaim: (
    operationId: string,
    claimId: string,
  ) => Effect.Effect<Committed<CommandStatus | undefined>, ReplicaStoreError>;

  readonly recoverStaleUploadClaims: (
    staleBefore: number,
  ) => Effect.Effect<Committed<number>, ReplicaStoreError>;
}

interface ReplicaRemoteApplyStore {
  readonly applyRemotePage: (
    page: SyncPullResult,
  ) => Effect.Effect<Committed<AppliedCursor>, ReplicaStoreError>;

  readonly applyTransactionGroup: (
    group: SyncTransactionGroup,
  ) => Effect.Effect<Committed<string>, ReplicaStoreError>;
}

type SnapshotImportProgress = {
  readonly partsImported: number;
};

export type SnapshotActivation =
  | { readonly _tag: "activated" }
  | {
      readonly _tag: "needsAuthority";
      readonly afterCommitSequence: string;
      readonly throughCommitSequence: string;
    };

export interface ReplicaSnapshotImportStore {
  readonly beginSnapshotImport: (
    manifest: SnapshotManifest,
  ) => Effect.Effect<SnapshotImportProgress, ReplicaStoreError, Scope.Scope>;

  readonly importSnapshotPart: (
    manifest: SnapshotManifest,
    part: SnapshotPartPayload,
  ) => Effect.Effect<void, ReplicaStoreError>;

  readonly applyCandidateAuthority: (
    snapshotId: SnapshotId,
    page: SyncPullResult,
  ) => Effect.Effect<string, ReplicaStoreError>;

  readonly abandonSnapshot: (snapshotId: SnapshotId) => Effect.Effect<void, ReplicaStoreError>;

  readonly activateSnapshot: (
    snapshotId: SnapshotId,
  ) => Effect.Effect<Committed<SnapshotActivation>, ReplicaStoreError>;
}

interface ReplicaCoverageStore {
  readonly markCoverageRepair: (
    subscription: SyncSubscription,
  ) => Effect.Effect<void, ReplicaStoreError>;

  readonly readDigestVerification: (
    subscription: SyncSubscription,
  ) => Effect.Effect<number | undefined, ReplicaStoreError>;

  readonly recordDigestVerification: (
    subscription: SyncSubscription,
    verifiedAt: number,
  ) => Effect.Effect<void, ReplicaStoreError>;

  readonly recordCaughtUp: (
    caughtUpAt: number,
  ) => Effect.Effect<Committed<void>, ReplicaStoreError>;
}

interface ReplicaPendingMarkStore {
  readonly readPendingMarks: () => Effect.Effect<
    ReadonlyArray<PendingRowMarkEntry>,
    ReplicaStoreError
  >;
}

interface ReplicaCommitFeed {
  readonly readStamp: () => Effect.Effect<ReplicaReadStamp, ReplicaStoreError>;

  readonly commits: Stream.Stream<ReplicaCommitNotice>;
}

export type ReplicaStoreContract = ReplicaRegistrationStore &
  ReplicaCommandStore &
  ReplicaUploadClaimStore &
  ReplicaRemoteApplyStore &
  ReplicaSnapshotImportStore &
  ReplicaCoverageStore &
  ReplicaPendingMarkStore &
  ReplicaCommitFeed;

export class ReplicaStore extends Context.Service<ReplicaStore, ReplicaStoreContract>()(
  "@store/sync/ReplicaStore",
) {}
