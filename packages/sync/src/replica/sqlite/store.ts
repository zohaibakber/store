import type {
  CommandReceipt,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncPullResult,
  SyncSubscription,
  SyncTransactionGroup,
} from "@store/contracts";
import type {
  CommandStatus,
  Committed,
  ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";

import type { SqliteDatabase } from "../../sqlite";
import { applyPullResult, applyTransactionGroup } from "../apply";
import {
  claimNextUpload,
  commandStatus,
  loadReplicaState,
  recoverStaleUploadClaims,
  releaseUploadClaim,
  saveLocalCommand,
  settleUploadClaim,
  type ClaimNextUploadInput,
  type UploadClaim,
  verifyAuthorityHeadNotBehind,
  verifyReplicaIncarnation,
} from "../commands";
import { makeReplicaCommitHub, noticeFromState } from "../commit-hub";
import { markCoverageRepair as markSqliteCoverageRepair } from "../coverage";
import { mapReplicaStoreFailure } from "../errors";
import {
  activateSnapshotGeneration,
  beginSnapshotImport as beginSqliteSnapshotImport,
  importSnapshotPart as importSqliteSnapshotPart,
} from "../import";
import { runReplicaTransaction, type ReplicaDb } from "../storage";
import type {
  AppliedCursor,
  QueuedCommand,
  ReplicaStoreContract,
  VerifyAuthorityInput,
} from "../store";

const storeFailure = mapReplicaStoreFailure;

const withTx = <A>(
  db: SqliteDatabase,
  run: (tx: ReplicaDb) => A,
): Effect.Effect<A, ReturnType<typeof mapReplicaStoreFailure>> =>
  Effect.try({
    try: () => runReplicaTransaction(db, run),
    catch: storeFailure,
  });

export const makeSqliteReplicaStore = (
  db: SqliteDatabase,
  databaseIdentity: string,
): Effect.Effect<ReplicaStoreContract> =>
  Effect.gen(function* () {
    const { publish, commits } = yield* makeReplicaCommitHub();

    const readStampSync = (): ReplicaReadStamp => {
      const state = runReplicaTransaction(db, (tx) => loadReplicaState(tx));
      return {
        generationId: String(state.activeGeneration),
        localCommitVersion: state.localCommitVersion,
      };
    };

    const enqueueCommand = Effect.fn("SqliteReplicaStore.enqueueCommand")(function* (
      envelope: SyncCommandEnvelope,
      createdAt: number,
    ) {
      const before = readStampSync();
      const status = yield* withTx(db, (tx) => saveLocalCommand(tx, envelope, createdAt));
      const after = readStampSync();
      const changed = after.localCommitVersion !== before.localCommitVersion;
      const committed: Committed<QueuedCommand> = {
        value: { operationId: envelope.operationId, status },
        notice: changed
          ? noticeFromState(
              databaseIdentity,
              after,
              ["batch"],
              [],
              [{ operationId: envelope.operationId, status }],
            )
          : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const claimUpload = Effect.fn("SqliteReplicaStore.claimNextUpload")(function* (
      input: ClaimNextUploadInput,
    ) {
      const before = readStampSync();
      const claim = yield* withTx(db, (tx) => claimNextUpload(tx, input));
      const after = readStampSync();
      const committed: Committed<UploadClaim | undefined> = {
        value: claim,
        notice:
          claim && after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(
                databaseIdentity,
                after,
                [],
                [],
                [{ operationId: claim.operationId, status: "sending" }],
              )
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const settleClaim = Effect.fn("SqliteReplicaStore.settleUploadClaim")(function* (
      claimId: string,
      receipt: CommandReceipt,
    ) {
      const before = readStampSync();
      const status = yield* withTx(db, (tx) => settleUploadClaim(tx, claimId, receipt));
      const after = readStampSync();
      const committed: Committed<CommandStatus | undefined> = {
        value: status,
        notice:
          status && after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(
                databaseIdentity,
                after,
                ["batch"],
                [],
                [{ operationId: receipt.operationId, status }],
              )
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const releaseClaim = Effect.fn("SqliteReplicaStore.releaseUploadClaim")(function* (
      operationId: string,
      claimId: string,
    ) {
      const before = readStampSync();
      const status = yield* withTx(db, (tx) => releaseUploadClaim(tx, operationId, claimId));
      const after = readStampSync();
      const committed: Committed<CommandStatus | undefined> = {
        value: status,
        notice:
          status && after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(databaseIdentity, after, [], [], [{ operationId, status }])
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const recoverStale = Effect.fn("SqliteReplicaStore.recoverStaleUploadClaims")(function* (
      staleBefore: number,
    ) {
      const before = readStampSync();
      const recovered = yield* withTx(db, (tx) => recoverStaleUploadClaims(tx, staleBefore));
      const after = readStampSync();
      const committed: Committed<number> = {
        value: recovered,
        notice:
          recovered > 0 && after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(databaseIdentity, after)
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const applyRemotePage = Effect.fn("SqliteReplicaStore.applyRemotePage")(function* (
      page: SyncPullResult,
    ) {
      const before = readStampSync();
      const applied = yield* withTx(db, (tx) => {
        verifyReplicaIncarnation(tx, page.incarnation);
        return applyPullResult(tx, page);
      });
      const after = readStampSync();
      const committed: Committed<AppliedCursor> = {
        value: applied,
        notice:
          after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(databaseIdentity, after, [
                "category",
                "product",
                "batch",
                "invoice",
                "invoiceItem",
                "stockMovement",
              ])
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const applyGroup = Effect.fn("SqliteReplicaStore.applyTransactionGroup")(function* (
      group: SyncTransactionGroup,
    ) {
      const before = readStampSync();
      const appliedThrough = yield* withTx(db, (tx) => applyTransactionGroup(tx, group));
      const after = readStampSync();
      const committed: Committed<string> = {
        value: appliedThrough,
        notice:
          after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(databaseIdentity, after, [
                "category",
                "product",
                "batch",
                "invoice",
                "invoiceItem",
                "stockMovement",
              ])
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const beginSnapshotImport = Effect.fn("SqliteReplicaStore.beginSnapshotImport")(function* (
      manifest: SnapshotManifest,
    ) {
      yield* withTx(db, (tx) => {
        beginSqliteSnapshotImport(tx, manifest);
      });
    });

    const importSnapshotPart = Effect.fn("SqliteReplicaStore.importSnapshotPart")(function* (
      manifest: SnapshotManifest,
      part: SnapshotPartPayload,
    ) {
      yield* withTx(db, (tx) => {
        importSqliteSnapshotPart(tx, manifest, part);
      });
    });

    const activateSnapshot = Effect.fn("SqliteReplicaStore.activateSnapshot")(function* (
      snapshotId: SnapshotId,
    ) {
      const before = readStampSync();
      yield* withTx(db, (tx) => {
        activateSnapshotGeneration(tx, snapshotId);
      });
      const after = readStampSync();
      const committed: Committed<void> = {
        value: undefined,
        notice:
          after.localCommitVersion !== before.localCommitVersion
            ? noticeFromState(databaseIdentity, after, [
                "category",
                "product",
                "batch",
                "invoice",
                "invoiceItem",
                "stockMovement",
              ])
            : undefined,
      };
      yield* publish(committed.notice);
      return committed;
    });

    const readSyncCursor = () =>
      withTx(db, (tx) => {
        const state = loadReplicaState(tx);
        return {
          epoch: state.epoch,
          appliedCommitSequence: state.appliedCommitSequence,
        };
      });

    const verifyAuthority = Effect.fn("SqliteReplicaStore.verifyAuthority")(function* (
      input: VerifyAuthorityInput,
    ) {
      yield* withTx(db, (tx) => {
        verifyReplicaIncarnation(tx, input.incarnation);
        verifyAuthorityHeadNotBehind(tx, input.horizon);
      });
    });

    const markCoverageRepair = Effect.fn("SqliteReplicaStore.markCoverageRepair")(function* (
      subscription: SyncSubscription,
    ) {
      yield* withTx(db, (tx) => {
        markSqliteCoverageRepair(tx, subscription);
      });
    });

    return {
      readSyncCursor,
      enqueueCommand,
      claimNextUpload: claimUpload,
      settleUploadClaim: settleClaim,
      releaseUploadClaim: releaseClaim,
      recoverStaleUploadClaims: recoverStale,
      applyRemotePage,
      applyTransactionGroup: applyGroup,
      beginSnapshotImport,
      importSnapshotPart,
      activateSnapshot,
      verifyAuthority,
      markCoverageRepair,
      readCommandStatus: (operationId) => withTx(db, (tx) => commandStatus(tx, operationId)),
      readStamp: () => Effect.try({ try: readStampSync, catch: storeFailure }),
      commits,
    } satisfies ReplicaStoreContract;
  });
