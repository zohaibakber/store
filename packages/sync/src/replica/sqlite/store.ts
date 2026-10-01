import type {
  CommandReceipt,
  EnqueueCommandRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartPayload,
  SyncPullResult,
  SyncSubscription,
  SyncTransactionGroup,
} from "@store/contracts";
import type {
  Committed,
  ReplicaCommitNotice,
  ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

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
  EMPTY_TOUCHED,
  makeReplicaCommitHub,
  mergeTouched,
  noticeFromState,
  stampOf,
  withStockTouched,
  type TouchedSet,
} from "../commit-hub";
import {
  loadDigestVerification,
  markCoverageRepair,
  recordDigestVerification,
  verifyPulledDigest,
  type DigestFence,
} from "../coverage";
import { isStorageFullFailure, mapReplicaStoreFailure } from "../errors";
import { generationResetNotice } from "../generation-reset";
import {
  abandonSnapshotCandidate,
  applyCandidateAuthority,
  beginSnapshotImport,
  importSnapshotRows,
  prepareSnapshotImport,
  stepSnapshotActivation,
  type SnapshotStep,
} from "../import";
import { listPendingMarks } from "../pending";
import { announcementOf } from "../registration";
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
  type SnapshotActivation,
  type VerifyAuthorityInput,
} from "../store";
import {
  BULK_CLEAR_IDLE_MILLIS,
  clearRetiredStep,
  IMPORT_CACHE_SIZE,
  IMPORT_FLUSH_PARTS,
  IMPORT_TURN_INITIAL_ROWS,
  IMPORT_TURN_MAX_ROWS,
  IMPORT_TURN_MILLIS,
  IMPORT_TURN_MIN_ROWS,
  IMPORT_WAL_CHECKPOINT_PAGES,
  recordActiveMutation,
  refreshPlannerStats,
  type BulkClear,
} from "./generation";
import {
  maintainReplicaPlanner,
  PLANNER_CHECK_INTERVAL,
  PLANNER_IDLE_MILLIS,
  PLANNER_REFRESH_MILLIS,
  PLANNER_START_DELAY,
} from "./planner";

type BufferedParts = {
  readonly manifest: SnapshotManifest;
  readonly parts: ReadonlyArray<SnapshotPartPayload>;
  readonly rowOffset: number;
};

type WindowSettings = {
  readonly checkpointPages: number;
  readonly cacheSize: number;
};

type CheckpointWindow = {
  readonly holders: ReadonlySet<string>;
  readonly prior: WindowSettings | undefined;
};

type SqliteReplicaStoreInternals = {
  readonly store: ReplicaStoreContract;
  readonly cleanup: Effect.Effect<void>;
  readonly requestCleanup: Effect.Effect<void>;
  readonly cleanupRequests: Queue.Dequeue<void>;
  readonly maintainPlanner: Effect.Effect<void>;
};

const makeSqliteReplicaStoreInternals = (
  handle: SqliteReplicaHandle,
  databaseIdentity: string,
): Effect.Effect<SqliteReplicaStoreInternals> =>
  Effect.gen(function* () {
    const { publish, commits } = yield* makeReplicaCommitHub();
    const cleanupRequests = yield* Queue.sliding<void>(1);
    const requestCleanup = Queue.offer(cleanupRequests, undefined).pipe(Effect.asVoid);
    const lastActivity = yield* Ref.make(0);
    const lastOptimized = yield* Ref.make<number | undefined>(undefined);
    const markActivity = Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) => Ref.set(lastActivity, now)),
    );

    const withTx = <A, E>(
      span: string,
      run: (tx: ReplicaDb) => Effect.Effect<A, E>,
    ): Effect.Effect<A, ReplicaStoreError> =>
      runReplicaTransaction(handle, run).pipe(
        Effect.ensuring(markActivity),
        Effect.mapError(mapReplicaStoreFailure),
        Effect.withSpan(span),
      );

    const maintainPlanner = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const optimizedAt = yield* Ref.get(lastOptimized);
      if (optimizedAt !== undefined && now - optimizedAt < PLANNER_REFRESH_MILLIS) return;
      if (now - (yield* Ref.get(lastActivity)) < PLANNER_IDLE_MILLIS) return;
      const outcome = yield* maintainReplicaPlanner(handle.sql);
      if (outcome === "optimized") yield* Ref.set(lastOptimized, now);
    }).pipe(
      Effect.tapError((error) => Effect.logWarning("Replica planner maintenance failed", error)),
      Effect.ignore,
      Effect.withSpan("SqliteReplicaStore.maintainPlanner"),
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

    const touchedNotice =
      <A>(touchedOf: (value: A) => TouchedSet) =>
      (value: A, after: ReplicaReadStamp) => {
        const touched = touchedOf(value);
        return noticeFromState(
          databaseIdentity,
          after,
          touched.touchedEntities,
          touched.touchedKeys,
        );
      };

    const enqueueCommand = (request: EnqueueCommandRequest) =>
      commit(
        "SqliteReplicaStore.enqueueCommand",
        (tx) =>
          saveLocalCommand(tx, request).pipe(
            Effect.tap((saved) =>
              saved.changed
                ? recordActiveMutation(tx, () => ({
                    kind: "local",
                    operationId: request.operationId,
                  }))
                : Effect.void,
            ),
          ),
        touchedNotice((saved) =>
          withStockTouched(saved.projection ?? EMPTY_TOUCHED, saved.stockBatchIds),
        ),
      ).pipe(
        Effect.map((committed) => ({
          value: {
            operationId: request.operationId,
            status: committed.value.status,
            stamp: committed.value.stamp,
          },
          notice: committed.notice,
        })),
      );

    const claimUpload = (input: ClaimNextUploadInput) =>
      commit(
        "SqliteReplicaStore.claimNextUpload",
        (tx) => claimNextUpload(tx, input),
        (claim, after) => claim && noticeFromState(databaseIdentity, after),
      );

    const settleAndJournal = (tx: ReplicaDb, claimId: string, receipt: CommandReceipt) =>
      settleUploadClaim(tx, claimId, receipt).pipe(
        Effect.tap((settled) =>
          settled?.restored
            ? recordActiveMutation(tx, () => ({ kind: "reject", operationId: receipt.operationId }))
            : Effect.void,
        ),
      );

    const settleClaim = (claimId: string, receipt: CommandReceipt) =>
      commit(
        "SqliteReplicaStore.settleUploadClaim",
        (tx) => settleAndJournal(tx, claimId, receipt),
        (settled, after) =>
          settled &&
          noticeFromState(
            databaseIdentity,
            after,
            settled.restored?.touchedEntities,
            settled.restored?.touchedKeys,
          ),
      ).pipe(
        Effect.map((committed) => ({ value: committed.value?.status, notice: committed.notice })),
      );

    const verifyDigest = (page: SyncPullResult, fence: DigestFence | undefined) =>
      verifyPulledDigest(withTx, page, fence);

    const settleClaimWithPage = (claimId: string, receipt: CommandReceipt, page: SyncPullResult) =>
      commit(
        "SqliteReplicaStore.settleUploadWithPage",
        (tx) =>
          Effect.gen(function* () {
            yield* verifyReplicaIncarnation(tx, page.incarnation);
            const settled = yield* settleAndJournal(tx, claimId, receipt);
            const applied = yield* applyPullResult(tx, page);
            return { settled, applied };
          }),
        touchedNotice((value) =>
          mergeTouched(value.settled?.restored ?? EMPTY_TOUCHED, value.applied),
        ),
      ).pipe(
        Effect.flatMap((committed) =>
          verifyDigest(page, committed.value.applied.digestFence).pipe(
            Effect.map((coverage) => ({
              value: { appliedThrough: committed.value.applied.appliedThrough, ...coverage },
              notice: committed.notice,
            })),
          ),
        ),
      );

    const releaseClaim = (operationId: string, claimId: string) =>
      commit(
        "SqliteReplicaStore.releaseUploadClaim",
        (tx) => releaseUploadClaim(tx, operationId, claimId),
        (status, after) => status && noticeFromState(databaseIdentity, after),
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
        touchedNotice((applied) => applied),
      ).pipe(
        Effect.flatMap((committed) =>
          verifyDigest(page, committed.value.digestFence).pipe(
            Effect.map((coverage) => ({
              value: { appliedThrough: committed.value.appliedThrough, ...coverage },
              notice: committed.notice,
            })),
          ),
        ),
      );

    const applyGroup = (group: SyncTransactionGroup) =>
      commit(
        "SqliteReplicaStore.applyTransactionGroup",
        (tx) => applyTransactionGroup(tx, group),
        touchedNotice((applied) => applied),
      ).pipe(
        Effect.map((committed) => ({
          value: committed.value.appliedThrough,
          notice: committed.notice,
        })),
      );

    const checkpointWindow = yield* SynchronizedRef.make<CheckpointWindow>({
      holders: new Set(),
      prior: undefined,
    });

    const readPragma = (name: string, fallback: number) =>
      handle.sql
        .unsafe<Record<string, number>>(`pragma ${name}`)
        .pipe(Effect.map((rows) => rows[0]?.[name] ?? fallback));

    const applyWindow = (settings: WindowSettings) =>
      handle.sql
        .unsafe(`pragma wal_autocheckpoint = ${settings.checkpointPages}`)
        .pipe(Effect.andThen(handle.sql.unsafe(`pragma cache_size = ${settings.cacheSize}`)));

    const widenCheckpoints = (holder: string) =>
      SynchronizedRef.updateEffect(checkpointWindow, (window) =>
        Effect.gen(function* () {
          const holders = new Set([...window.holders, holder]);
          if (window.prior !== undefined) return { holders, prior: window.prior };
          const prior = {
            checkpointPages: yield* readPragma("wal_autocheckpoint", 1_000),
            cacheSize: yield* readPragma("cache_size", -2_000),
          };
          yield* applyWindow({
            checkpointPages: IMPORT_WAL_CHECKPOINT_PAGES,
            cacheSize: IMPORT_CACHE_SIZE,
          });
          return { holders, prior };
        }),
      ).pipe(Effect.uninterruptible, Effect.mapError(mapReplicaStoreFailure));

    const restoreCheckpoints = (holder: string) =>
      SynchronizedRef.updateEffect(checkpointWindow, (window) => {
        if (!window.holders.has(holder)) return Effect.succeed(window);
        const holders = new Set([...window.holders].filter((entry) => entry !== holder));
        if (holders.size > 0 || window.prior === undefined) {
          return Effect.succeed({ holders, prior: window.prior });
        }
        return applyWindow(window.prior).pipe(
          Effect.as({ holders, prior: undefined }),
          Effect.orElseSucceed(() => ({ holders, prior: window.prior })),
        );
      }).pipe(Effect.uninterruptible);

    const holdCheckpoints = (holder: string) =>
      Effect.acquireRelease(widenCheckpoints(holder), () => restoreCheckpoints(holder));

    const bufferedParts = yield* Ref.make<BufferedParts | undefined>(undefined);
    const importRowBudget = yield* Ref.make(IMPORT_TURN_INITIAL_ROWS);

    const adaptRowBudget = (rows: number, tookMillis: number) =>
      Ref.set(
        importRowBudget,
        Math.min(
          IMPORT_TURN_MAX_ROWS,
          Math.max(
            IMPORT_TURN_MIN_ROWS,
            Math.round(Math.sqrt(rows * ((rows * IMPORT_TURN_MILLIS) / Math.max(1, tookMillis)))),
          ),
        ),
      );

    const flushStep = Effect.gen(function* () {
      const buffered = yield* Ref.get(bufferedParts);
      if (buffered === undefined) return 0;
      const rowBudget = yield* Ref.get(importRowBudget);
      const [took, imported] = yield* withTx("SqliteReplicaStore.importSnapshotRows", (tx) =>
        importSnapshotRows(tx, buffered.manifest, buffered.parts, buffered.rowOffset, rowBudget),
      ).pipe(storageFullGuard(buffered.manifest.snapshotId), Effect.timed);
      const remaining = buffered.parts.slice(imported.partsCompleted);
      yield* Ref.set(
        bufferedParts,
        remaining.length === 0
          ? undefined
          : { manifest: buffered.manifest, parts: remaining, rowOffset: imported.rowOffset },
      );
      yield* adaptRowBudget(rowBudget, Duration.toMillis(took));
      return remaining.length;
    });

    const flushUntil = (buffered: number) =>
      Effect.repeat(flushStep.pipe(Effect.tap(() => Effect.yieldNow)), {
        until: (remaining) => remaining <= buffered,
      }).pipe(Effect.asVoid);

    const drainBufferedParts = flushUntil(0);

    const bufferPart = (manifest: SnapshotManifest, part: SnapshotPartPayload) =>
      Effect.gen(function* () {
        const buffered = yield* Ref.get(bufferedParts);
        const carried =
          buffered?.manifest.snapshotId === manifest.snapshotId
            ? buffered
            : { parts: [], rowOffset: 0 };
        const parts = [...carried.parts, part];
        yield* Ref.set(bufferedParts, { manifest, parts, rowOffset: carried.rowOffset });
        if (parts.length >= IMPORT_FLUSH_PARTS) yield* flushUntil(IMPORT_FLUSH_PARTS - 1);
        yield* Effect.yieldNow;
      });

    const clearRetiredStepWith = (bulkClear: BulkClear) =>
      withTx("SqliteReplicaStore.clearRetiredStep", (tx) => clearRetiredStep(tx, bulkClear));

    const clearRetired = Effect.repeat(
      clearRetiredStepWith("allow").pipe(Effect.tap(() => Effect.yieldNow)),
      { until: (step) => !step.remaining },
    ).pipe(Effect.asVoid);

    const idleShortfall = Effect.gen(function* () {
      const idleFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastActivity));
      return Math.max(0, BULK_CLEAR_IDLE_MILLIS - idleFor);
    });

    const awaitIdle = Effect.repeat(
      idleShortfall.pipe(
        Effect.tap((shortfall) => (shortfall > 0 ? Effect.sleep(shortfall) : Effect.void)),
      ),
      { until: (shortfall) => shortfall === 0 },
    );

    const clearRetiredWhenIdle = Effect.repeat(
      clearRetiredStepWith("defer").pipe(
        Effect.flatMap((step) =>
          step.awaitingIdle
            ? awaitIdle.pipe(Effect.andThen(clearRetiredStepWith("allow")))
            : Effect.succeed(step),
        ),
        Effect.tap(() => Effect.yieldNow),
      ),
      { until: (step) => !step.remaining },
    ).pipe(Effect.asVoid);

    const cleanup = Effect.gen(function* () {
      yield* holdCheckpoints("cleanup").pipe(Effect.andThen(clearRetiredWhenIdle), Effect.scoped);
      yield* withTx("SqliteReplicaStore.refreshPlannerStats", refreshPlannerStats);
    }).pipe(
      Effect.tapError((error) => Effect.logWarning("Replica generation cleanup failed", error)),
      Effect.ignore,
    );

    const storageFullGuard =
      (snapshotId: string) =>
      <A, R>(effect: Effect.Effect<A, ReplicaStoreError, R>) =>
        effect.pipe(
          Effect.tapError((error) =>
            isStorageFullFailure(error)
              ? withTx("SqliteReplicaStore.abandonFullSnapshot", (tx) =>
                  abandonSnapshotCandidate(tx, snapshotId),
                ).pipe(
                  Effect.andThen(restoreCheckpoints("import")),
                  Effect.andThen(requestCleanup),
                  Effect.ignore,
                )
              : Effect.void,
          ),
        );

    const stepNotice = (step: SnapshotStep, after: ReplicaReadStamp) =>
      step._tag === "activated" ? generationResetNotice(databaseIdentity, after) : undefined;

    const activateDrained = (snapshotId: SnapshotId) =>
      Effect.repeat(
        commit(
          "SqliteReplicaStore.stepSnapshotActivation",
          (tx) => stepSnapshotActivation(tx, snapshotId),
          stepNotice,
        ).pipe(Effect.tap(() => Effect.yieldNow)),
        { until: (committed) => committed.value._tag !== "progressed" },
      ).pipe(
        storageFullGuard(snapshotId),
        Effect.tap((committed) =>
          committed.value._tag === "activated"
            ? restoreCheckpoints("import").pipe(Effect.andThen(requestCleanup))
            : Effect.void,
        ),
        Effect.map((committed): Committed<SnapshotActivation> => ({
          value:
            committed.value._tag === "needsAuthority" ? committed.value : { _tag: "activated" },
          notice: committed.notice,
        })),
      );

    const activateSnapshot = (snapshotId: SnapshotId) =>
      drainBufferedParts.pipe(Effect.andThen(activateDrained(snapshotId)));

    const recordCaughtUpAt = (caughtUpAt: number) =>
      withTx("SqliteReplicaStore.recordCaughtUp", (tx) =>
        recordCaughtUp(tx, caughtUpAt).pipe(
          Effect.map((state) => noticeFromState(databaseIdentity, stampOf(state))),
        ),
      ).pipe(
        Effect.tap(publish),
        Effect.map((notice): Committed<void> => ({ value: undefined, notice })),
      );

    const store = {
      readSyncCursor: () =>
        withTx("SqliteReplicaStore.readSyncCursor", (tx) =>
          loadReplicaState(tx).pipe(
            Effect.map((state) => ({
              epoch: state.epoch,
              appliedCommitSequence: state.appliedCommitSequence,
              replicaId: state.replicaId,
              bootstrapped: state.caughtUpAt !== null || state.activeGeneration !== 1,
              ...announcementOf(state),
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
      settleUploadWithPage: settleClaimWithPage,
      releaseUploadClaim: releaseClaim,
      recoverStaleUploadClaims: recoverStale,
      applyRemotePage,
      applyTransactionGroup: applyGroup,
      beginSnapshotImport: (manifest: SnapshotManifest) =>
        Ref.update(bufferedParts, (buffered) =>
          buffered?.manifest.snapshotId === manifest.snapshotId ? buffered : undefined,
        ).pipe(
          Effect.andThen(drainBufferedParts),
          Effect.andThen(
            withTx("SqliteReplicaStore.prepareSnapshotImport", (tx) =>
              prepareSnapshotImport(tx, manifest.snapshotId),
            ),
          ),
          Effect.andThen(clearRetired),
          Effect.andThen(holdCheckpoints("import")),
          Effect.andThen(
            withTx("SqliteReplicaStore.beginSnapshotImport", (tx) =>
              beginSnapshotImport(tx, manifest).pipe(
                Effect.map((stage) => ({
                  partsImported:
                    stage._tag === "importing" ? stage.partsImported : manifest.parts.length,
                })),
              ),
            ),
          ),
          storageFullGuard(manifest.snapshotId),
        ),
      importSnapshotPart: (manifest: SnapshotManifest, part: SnapshotPartPayload) =>
        bufferPart(manifest, part),
      applyCandidateAuthority: (snapshotId: SnapshotId, page: SyncPullResult) =>
        withTx("SqliteReplicaStore.applyCandidateAuthority", (tx) =>
          applyCandidateAuthority(tx, snapshotId, page),
        ).pipe(
          storageFullGuard(snapshotId),
          Effect.tap(() => Effect.yieldNow),
        ),
      abandonSnapshot: (snapshotId: SnapshotId) =>
        Ref.set(bufferedParts, undefined).pipe(
          Effect.andThen(
            withTx("SqliteReplicaStore.abandonSnapshot", (tx) =>
              abandonSnapshotCandidate(tx, snapshotId),
            ),
          ),
          Effect.andThen(restoreCheckpoints("import")),
          Effect.andThen(requestCleanup),
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

    return {
      store,
      cleanup,
      requestCleanup,
      cleanupRequests,
      maintainPlanner,
    } satisfies SqliteReplicaStoreInternals;
  });

export const makeSqliteReplicaStore = (
  handle: SqliteReplicaHandle,
  databaseIdentity: string,
): Effect.Effect<ReplicaStoreContract> =>
  makeSqliteReplicaStoreInternals(handle, databaseIdentity).pipe(
    Effect.map((internals) => internals.store),
  );

export const layerSqliteReplicaStore = (
  databaseIdentity: string,
): Layer.Layer<ReplicaStore, never, SqliteReplica> =>
  Layer.effect(
    ReplicaStore,
    Effect.gen(function* () {
      const handle = yield* SqliteReplica;
      const internals = yield* makeSqliteReplicaStoreInternals(handle, databaseIdentity);
      yield* internals.requestCleanup;
      yield* Stream.fromQueue(internals.cleanupRequests).pipe(
        Stream.mapEffect(() => internals.cleanup),
        Stream.runDrain,
        Effect.forkScoped,
      );
      yield* internals.maintainPlanner.pipe(
        Effect.repeat(Schedule.spaced(PLANNER_CHECK_INTERVAL)),
        Effect.delay(PLANNER_START_DELAY),
        Effect.forkScoped,
      );

      return internals.store;
    }),
  );
