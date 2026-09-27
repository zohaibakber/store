import type {
  CommandReceipt,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncPullResult,
  SyncSubscription,
  SyncTransactionGroup,
} from "@store/contracts";
import type {
  Committed,
  ReplicaCommitNotice,
  ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { applyPullResult, applyTransactionGroup } from "../apply";
import {
  adoptReplicaRegistration,
  claimNextUpload,
  commandStatus,
  loadReplicaState,
  recordCaughtUp,
  recoverStaleUploadClaims,
  releaseUploadClaim,
  saveLocalCommand,
  settleUploadClaim,
  verifyAuthorityHeadNotBehind,
  verifyReplicaIncarnation,
  type ClaimNextUploadInput,
} from "../commands";
import {
  makeReplicaCommitHub,
  noticeFromState,
  stampOf,
  touchedEntitiesWithStock,
} from "../commit-hub";
import { loadDigestVerification, markCoverageRepair, recordDigestVerification } from "../coverage";
import { SYNC_ENTITIES } from "../decisions";
import { mapReplicaStoreFailure } from "../errors";
import { activateSnapshotGeneration, beginSnapshotImport, importSnapshotPart } from "../import";
import { listPendingMarks } from "../pending";
import type { ReplicaDb } from "../sql-client/drizzle";
import {
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "../sql-client/handle";
import {
  ReplicaStore,
  type ReplicaStoreContract,
  type ReplicaStoreError,
  type VerifyAuthorityInput,
} from "../store";

export const makeSqliteReplicaStore = (
  handle: SqliteReplicaHandle,
  databaseIdentity: string,
): Effect.Effect<ReplicaStoreContract> =>
  Effect.gen(function* () {
    const { publish, commits } = yield* makeReplicaCommitHub();

    const withTx = <A, E>(
      span: string,
      run: (tx: ReplicaDb) => Effect.Effect<A, E>,
    ): Effect.Effect<A, ReplicaStoreError> =>
      runReplicaTransaction(handle, run).pipe(
        Effect.mapError(mapReplicaStoreFailure),
        Effect.withSpan(span),
      );

    const readStamp = (tx: ReplicaDb) => loadReplicaState(tx).pipe(Effect.map(stampOf));

    const commit = <A, E>(
      span: string,
      run: (tx: ReplicaDb) => Effect.Effect<A, E>,
      notice: (value: A, after: ReplicaReadStamp) => ReplicaCommitNotice | undefined,
    ): Effect.Effect<Committed<A>, ReplicaStoreError> =>
      withTx(span, (tx) =>
        Effect.gen(function* () {
          const before = yield* readStamp(tx);
          const value = yield* run(tx);
          const after = yield* readStamp(tx);
          const changed = after.localCommitVersion !== before.localCommitVersion;
          return { value, notice: changed ? notice(value, after) : undefined };
        }),
      ).pipe(Effect.tap((committed) => publish(committed.notice)));

    const allEntitiesNotice =
      <A>(touchedKeys: (value: A) => ReadonlyArray<string>) =>
      (value: A, after: ReplicaReadStamp) =>
        noticeFromState(databaseIdentity, after, SYNC_ENTITIES, touchedKeys(value));

    const enqueueCommand = (envelope: SyncCommandEnvelope, createdAt: number) =>
      commit(
        "SqliteReplicaStore.enqueueCommand",
        (tx) => saveLocalCommand(tx, envelope, createdAt),
        (saved, after) =>
          noticeFromState(
            databaseIdentity,
            after,
            touchedEntitiesWithStock(saved.projection?.touchedEntities),
            saved.projection?.touchedKeys ?? [],
            [{ operationId: envelope.operationId, status: saved.status }],
          ),
      ).pipe(
        Effect.map((committed) => ({
          value: { operationId: envelope.operationId, status: committed.value.status },
          notice: committed.notice,
        })),
      );

    const claimUpload = (input: ClaimNextUploadInput) =>
      commit(
        "SqliteReplicaStore.claimNextUpload",
        (tx) => claimNextUpload(tx, input),
        (claim, after) =>
          claim &&
          noticeFromState(
            databaseIdentity,
            after,
            [],
            [],
            [{ operationId: claim.operationId, status: "sending" }],
          ),
      );

    const settleClaim = (claimId: string, receipt: CommandReceipt) =>
      commit(
        "SqliteReplicaStore.settleUploadClaim",
        (tx) => settleUploadClaim(tx, claimId, receipt),
        (settled, after) =>
          settled &&
          noticeFromState(
            databaseIdentity,
            after,
            touchedEntitiesWithStock(settled.restored?.touchedEntities),
            settled.restored?.touchedKeys ?? [],
            [{ operationId: receipt.operationId, status: settled.status }],
          ),
      ).pipe(
        Effect.map((committed) => ({ value: committed.value?.status, notice: committed.notice })),
      );

    const releaseClaim = (operationId: string, claimId: string) =>
      commit(
        "SqliteReplicaStore.releaseUploadClaim",
        (tx) => releaseUploadClaim(tx, operationId, claimId),
        (status, after) =>
          status && noticeFromState(databaseIdentity, after, [], [], [{ operationId, status }]),
      );

    const recoverStale = (staleBefore: number) =>
      commit(
        "SqliteReplicaStore.recoverStaleUploadClaims",
        (tx) => recoverStaleUploadClaims(tx, staleBefore),
        (recovered, after) =>
          recovered > 0 ? noticeFromState(databaseIdentity, after) : undefined,
      );

    const applyRemotePage = (page: SyncPullResult) =>
      commit(
        "SqliteReplicaStore.applyRemotePage",
        (tx) =>
          verifyReplicaIncarnation(tx, page.incarnation).pipe(
            Effect.andThen(applyPullResult(tx, page)),
          ),
        allEntitiesNotice((applied) => applied.touchedKeys),
      ).pipe(
        Effect.map((committed) => ({
          value: {
            appliedThrough: committed.value.appliedThrough,
            repairRequired: committed.value.repairRequired,
            digestVerified: committed.value.digestVerified,
          },
          notice: committed.notice,
        })),
      );

    const applyGroup = (group: SyncTransactionGroup) =>
      commit(
        "SqliteReplicaStore.applyTransactionGroup",
        (tx) => applyTransactionGroup(tx, group),
        allEntitiesNotice((applied) => applied.touchedKeys),
      ).pipe(
        Effect.map((committed) => ({
          value: committed.value.appliedThrough,
          notice: committed.notice,
        })),
      );

    const activateSnapshot = (snapshotId: SnapshotId) =>
      commit(
        "SqliteReplicaStore.activateSnapshot",
        (tx) => Effect.asVoid(activateSnapshotGeneration(tx, snapshotId)),
        allEntitiesNotice(() => []),
      );

    const recordCaughtUpAt = (caughtUpAt: number) =>
      withTx("SqliteReplicaStore.recordCaughtUp", (tx) =>
        recordCaughtUp(tx, caughtUpAt).pipe(
          Effect.map((state) => noticeFromState(databaseIdentity, stampOf(state))),
        ),
      ).pipe(
        Effect.tap(publish),
        Effect.map((notice): Committed<void> => ({ value: undefined, notice })),
      );

    return {
      readSyncCursor: () =>
        withTx("SqliteReplicaStore.readSyncCursor", (tx) =>
          loadReplicaState(tx).pipe(
            Effect.map((state) => ({
              epoch: state.epoch,
              appliedCommitSequence: state.appliedCommitSequence,
              replicaId: state.replicaId,
              registered: state.registeredAt !== null,
            })),
          ),
        ),
      adoptRegistration: (authority: RegisterReplicaResult, registeredAt: number) =>
        withTx("SqliteReplicaStore.adoptRegistration", (tx) =>
          adoptReplicaRegistration(tx, authority, registeredAt),
        ),
      enqueueCommand,
      claimNextUpload: claimUpload,
      settleUploadClaim: settleClaim,
      releaseUploadClaim: releaseClaim,
      recoverStaleUploadClaims: recoverStale,
      applyRemotePage,
      applyTransactionGroup: applyGroup,
      beginSnapshotImport: (manifest: SnapshotManifest) =>
        withTx("SqliteReplicaStore.beginSnapshotImport", (tx) =>
          Effect.asVoid(beginSnapshotImport(tx, manifest)),
        ),
      importSnapshotPart: (manifest: SnapshotManifest, part: SnapshotPartPayload) =>
        withTx("SqliteReplicaStore.importSnapshotPart", (tx) =>
          Effect.asVoid(importSnapshotPart(tx, manifest, part)),
        ),
      activateSnapshot,
      verifyAuthority: (input: VerifyAuthorityInput) =>
        withTx("SqliteReplicaStore.verifyAuthority", (tx) =>
          verifyReplicaIncarnation(tx, input.incarnation).pipe(
            Effect.andThen(verifyAuthorityHeadNotBehind(tx, input.horizon)),
          ),
        ),
      markCoverageRepair: (subscription: SyncSubscription) =>
        withTx("SqliteReplicaStore.markCoverageRepair", (tx) =>
          markCoverageRepair(tx, subscription),
        ),
      readDigestVerification: (subscription: SyncSubscription) =>
        withTx("SqliteReplicaStore.readDigestVerification", (tx) =>
          loadDigestVerification(tx, subscription),
        ).pipe(Effect.map((verification) => verification.verifiedAt)),
      recordDigestVerification: (subscription: SyncSubscription, verifiedAt: number) =>
        withTx("SqliteReplicaStore.recordDigestVerification", (tx) =>
          recordDigestVerification(tx, subscription, verifiedAt),
        ),
      readCommandStatus: (operationId) =>
        withTx("SqliteReplicaStore.readCommandStatus", (tx) => commandStatus(tx, operationId)),
      readPendingMarks: () =>
        withTx("SqliteReplicaStore.readPendingMarks", (tx) => listPendingMarks(tx)),
      readStamp: () => withTx("SqliteReplicaStore.readStamp", readStamp),
      recordCaughtUp: recordCaughtUpAt,
      commits,
    } satisfies ReplicaStoreContract;
  });

export const layerSqliteReplicaStore = (
  databaseIdentity: string,
): Layer.Layer<ReplicaStore, never, SqliteReplica> =>
  Layer.effect(
    ReplicaStore,
    SqliteReplica.use((handle) => makeSqliteReplicaStore(handle, databaseIdentity)),
  );
