import {
  OrgCommitSequence,
  syncProtocolError,
  type CommandReceipt,
  type EnqueueCommandRequest,
  type RegisterReplicaResult,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncCommandEnvelope,
  type SyncPullResult,
  type SyncSubmitCommandRequest,
  type SyncSubmitCommandResult,
  type SyncSubscription,
} from "@store/contracts";
import type {
  CommandStatus,
  Committed,
  ReplicaCommitNotice,
  ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { admitAuthorityWithin, applyAdmission } from "../apply";
import {
  adoptReplicaRegistration,
  claimNextUpload,
  commandStatus,
  loadReplicaState,
  recordCaughtUp,
  recordCommandReceipt,
  releaseUploadClaim,
  projectAdmittedCommand,
  pruneIntegratedCommands,
  queueAdmittedCommand,
  admitLocalCommand,
  settleUploadClaim,
  type ClaimNextUploadInput,
} from "../commands";
import {
  EMPTY_TOUCHED,
  generationResetNotice,
  makeReplicaCommitHub,
  mergeTouched,
  noticeFromState,
  stampOf,
  type TouchedSet,
} from "../commit-hub";
import {
  loadDigestVerification,
  markCoverageRepair,
  recordDigestVerification,
  UNVERIFIED,
  verifyPulledDigest,
} from "../coverage";
import { isStorageFullFailure, mapReplicaStoreFailure } from "../errors";
import {
  abandonSnapshotCandidate,
  applyCandidateAuthority,
  beginSnapshotImport,
  importSnapshotRows,
  prepareSnapshotImport,
  stepSnapshotActivation,
  type SnapshotStep,
} from "../import";
import { syncCursorOf } from "../registration";
import type { ReplicaDb } from "../sql-client/drizzle";
import {
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "../sql-client/handle";
import {
  ReplicaStore,
  type IntegrateAuthorityInput,
  type Integrated,
  type ReplicaStoreContract,
  type ReplicaStoreError,
  type SnapshotActivation,
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
import { listPendingMarks } from "./pending-rows";
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

type InTransactionAuthority = (
  tx: ReplicaDb,
  request: SyncSubmitCommandRequest,
) => Effect.Effect<SyncSubmitCommandResult, unknown>;

export type SqliteReplicaStoreOptions = {
  readonly authority?: InTransactionAuthority;
};

type EnqueuedCommand = {
  readonly status: CommandStatus;
  readonly stamp: ReplicaReadStamp;
  readonly touched: TouchedSet;
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
  options: SqliteReplicaStoreOptions,
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

    const stampAfter = (notice: ReplicaCommitNotice | undefined): ReplicaReadStamp | undefined =>
      notice && {
        generationId: notice.generationId,
        localCommitVersion: notice.localCommitVersion,
      };

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

    const settleAndJournal = (
      tx: ReplicaDb,
      receipt: CommandReceipt,
      claimId: string | undefined,
    ) =>
      (claimId === undefined
        ? recordCommandReceipt(tx, receipt)
        : settleUploadClaim(tx, claimId, receipt)
      ).pipe(
        Effect.tap((settled) =>
          settled?.restored
            ? recordActiveMutation(tx, () => ({ kind: "reject", operationId: receipt.operationId }))
            : Effect.void,
        ),
      );

    const integrateWithin = (
      tx: ReplicaDb,
      payload: IntegrateAuthorityInput["payload"],
      receipt:
        | { readonly claimId: string | undefined; readonly receipt: CommandReceipt }
        | undefined,
    ) =>
      Effect.gen(function* () {
        const admission = yield* admitAuthorityWithin(tx, payload);
        const settled =
          receipt === undefined
            ? undefined
            : yield* settleAndJournal(tx, receipt.receipt, receipt.claimId);
        const applied = yield* applyAdmission(tx, payload, admission);
        return { settled, applied };
      });

    const touchedByIntegrating = (value: Effect.Success<ReturnType<typeof integrateWithin>>) =>
      mergeTouched(value.settled?.restored ?? EMPTY_TOUCHED, value.applied);

    const decideWithin = (
      tx: ReplicaDb,
      envelope: SyncCommandEnvelope,
      appliedCommitSequence: string,
    ) =>
      Effect.gen(function* () {
        const authority = options.authority;
        if (authority === undefined) return undefined;
        const decided = yield* authority(tx, {
          ...envelope,
          afterCommitSequence: OrgCommitSequence.make(appliedCommitSequence),
        }).pipe(
          Effect.tapError((cause) =>
            Effect.logDebug(
              "The in-transaction authority left a command to the upload queue",
              cause,
            ),
          ),
          Effect.option,
        );
        if (Option.isNone(decided)) return undefined;
        const { page, ...receipt } = decided.value;
        if (page === undefined) return undefined;
        if (receipt.result._tag === "rejected") {
          return yield* Effect.fail(syncProtocolError(receipt.result.code, receipt.result.message));
        }
        return { receipt, page };
      });

    const enqueueCommand = (request: EnqueueCommandRequest) =>
      commit(
        "SqliteReplicaStore.enqueueCommand",
        (tx) =>
          Effect.gen(function* () {
            const admission = yield* admitLocalCommand(tx, request);
            if (admission._tag === "replayed") {
              return {
                status: admission.status,
                stamp: admission.stamp,
                touched: EMPTY_TOUCHED,
              } satisfies EnqueuedCommand;
            }
            const decided = yield* decideWithin(
              tx,
              admission.envelope,
              admission.state.appliedCommitSequence,
            );
            const projected =
              decided === undefined ? yield* projectAdmittedCommand(tx, admission) : EMPTY_TOUCHED;
            const stamp = yield* queueAdmittedCommand(tx, admission, request.occurredAt);
            yield* recordActiveMutation(tx, () => ({
              kind: "local",
              operationId: request.operationId,
            }));
            if (decided === undefined) {
              return { status: "pending", stamp, touched: projected } satisfies EnqueuedCommand;
            }
            const integrated = yield* integrateWithin(
              tx,
              { _tag: "submitPage", page: decided.page },
              { claimId: undefined, receipt: decided.receipt },
            );
            if (integrated.applied.outcome._tag === "refused") {
              return yield* integrated.applied.outcome.error;
            }
            yield* pruneIntegratedCommands(tx, admission.envelope.clientSequence);
            return {
              status: (yield* commandStatus(tx, request.operationId)) ?? "pending",
              stamp,
              touched: touchedByIntegrating(integrated),
            } satisfies EnqueuedCommand;
          }),
        touchedNotice((queued) => queued.touched),
      ).pipe(
        Effect.map((committed) => ({
          value: {
            operationId: request.operationId,
            status: committed.value.status,
            stamp: stampAfter(committed.notice) ?? committed.value.stamp,
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

    const settleClaim = (claimId: string, receipt: CommandReceipt) =>
      commit(
        "SqliteReplicaStore.settleUploadClaim",
        (tx) => settleAndJournal(tx, receipt, claimId),
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

    const integrateAuthority = (input: IntegrateAuthorityInput) =>
      commit(
        "SqliteReplicaStore.integrateAuthority",
        (tx) => integrateWithin(tx, input.payload, input.receipt),
        touchedNotice(touchedByIntegrating),
      ).pipe(
        Effect.flatMap((committed) => {
          const { applied } = committed.value;
          return (
            input.payload._tag === "liveFrame"
              ? Effect.succeed(UNVERIFIED)
              : verifyPulledDigest(withTx, input.payload.page, applied.digestFence)
          ).pipe(
            Effect.map((coverage): Committed<Integrated> => ({
              value: {
                outcome: applied.outcome,
                appliedThrough: applied.appliedThrough,
                ...coverage,
              },
              notice: committed.notice,
            })),
          );
        }),
      );

    const releaseClaim = (operationId: string, claimId: string) =>
      commit(
        "SqliteReplicaStore.releaseUploadClaim",
        (tx) => releaseUploadClaim(tx, operationId, claimId),
        (status, after) => status && noticeFromState(databaseIdentity, after),
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
          loadReplicaState(tx).pipe(Effect.map(syncCursorOf)),
        ),
      adoptRegistration: (authority: RegisterReplicaResult, registeredAt: number) =>
        withTx("SqliteReplicaStore.adoptRegistration", (tx) =>
          Effect.gen(function* () {
            const outcome = yield* adoptReplicaRegistration(tx, authority, registeredAt);
            return { outcome, notice: noticeFromState(databaseIdentity, yield* readStamp(tx)) };
          }),
        ).pipe(
          Effect.tap(({ outcome, notice }) =>
            outcome._tag === "registered" ? publish(notice) : Effect.void,
          ),
          Effect.map(({ outcome }) => outcome),
        ),
      enqueueCommand,
      claimNextUpload: claimUpload,
      settleUploadClaim: settleClaim,
      releaseUploadClaim: releaseClaim,
      integrateAuthority,
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
  options: SqliteReplicaStoreOptions = {},
): Effect.Effect<ReplicaStoreContract> =>
  makeSqliteReplicaStoreInternals(handle, databaseIdentity, options).pipe(
    Effect.map((internals) => internals.store),
  );

export const layerSqliteReplicaStore = (
  databaseIdentity: string,
  options: SqliteReplicaStoreOptions = {},
): Layer.Layer<ReplicaStore, never, SqliteReplica> =>
  Layer.effect(
    ReplicaStore,
    Effect.gen(function* () {
      const handle = yield* SqliteReplica;
      const internals = yield* makeSqliteReplicaStoreInternals(handle, databaseIdentity, options);
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
