import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  syncProtocolError,
  type SyncProtocolCode,
  type SyncProtocolError,
  type SyncPullRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { withDetachedScope } from "./detached-scope";
import { SyncEngine, type SyncEngineContract } from "./engine";
import { runLiveWakeLoop, type LiveWakeHost } from "./live-wake";
import { recoverRequiredSnapshot, type SnapshotRecoveryError } from "./recovery";
import { ReplicaStorageError, SyncRecoveryRequired } from "./replica/errors";
import { ReplicaStore, type ReplicaStoreContract, type ReplicaStoreError } from "./replica/store";
import {
  defaultHttpPollPolicy,
  SyncScheduler,
  type SyncSchedulerContract,
  type SyncSchedulerPolicy,
  type SyncWakeReason,
} from "./scheduler";
import { SyncTransportService, type SyncTransport } from "./transport";
import { makeWebNetworkOwnership, type WebNetworkOwnership } from "./web-ownership";

export type OwnedHttpSync = {
  readonly engine: SyncEngineContract;
  readonly scheduler: SyncSchedulerContract;
  readonly ownership: WebNetworkOwnership;
  readonly wake: (reason?: SyncWakeReason) => Effect.Effect<void>;
  readonly dispose: Effect.Effect<void>;
};

export type OwnedHttpSyncOptions = {
  readonly databaseIdentity: string;
  readonly live?: LiveWakeHost;
  readonly policy?: SyncSchedulerPolicy;
};

const decodeEpoch = Schema.decodeUnknownEffect(SyncEpoch);

const cursorFromStore = (store: ReplicaStoreContract) =>
  store.readSyncCursor().pipe(
    Effect.flatMap((cursor) =>
      decodeEpoch(cursor.epoch).pipe(
        Effect.mapError((error) => ReplicaStorageError.make({ message: error.message })),
        Effect.map((epoch) => ({ ...cursor, epoch })),
      ),
    ),
  );

const pullRequestFromStore = (
  store: ReplicaStoreContract,
): Effect.Effect<SyncPullRequest, ReplicaStoreError> =>
  cursorFromStore(store).pipe(
    Effect.map((cursor) => ({
      epoch: cursor.epoch,
      subscription: OPERATIONAL_SUBSCRIPTION,
      afterCommitSequence: OrgCommitSequence.make(cursor.appliedCommitSequence),
    })),
  );

export const recoverFrom = (
  store: ReplicaStoreContract,
  transport: SyncTransport,
  code: SyncProtocolCode,
): Effect.Effect<void, SnapshotRecoveryError | SyncRecoveryRequired> => {
  switch (code) {
    case "SNAPSHOT_REQUIRED":
      return cursorFromStore(store).pipe(
        Effect.flatMap((cursor) =>
          recoverRequiredSnapshot(transport, store, {
            epoch: cursor.epoch,
            subscription: OPERATIONAL_SUBSCRIPTION,
            replicaId: cursor.replicaId,
          }),
        ),
      );
    case "EPOCH_MISMATCH":
    case "INCARNATION_MISMATCH":
      return Effect.fail(
        SyncRecoveryRequired.make({
          code,
          message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
        }),
      );
    default:
      return Effect.fail(syncProtocolError(code, "The sync failure has no local recovery."));
  }
};

const ownHttpSync = (
  options: OwnedHttpSyncOptions,
): Effect.Effect<
  Omit<OwnedHttpSync, "wake" | "dispose">,
  ReplicaStoreError,
  ReplicaStore | SyncTransportService | SyncEngine | Scope.Scope
> =>
  Effect.gen(function* () {
    const store = yield* ReplicaStore;
    const transport = yield* SyncTransportService;
    const engine = yield* SyncEngine;
    const ownership = yield* Effect.acquireRelease(
      makeWebNetworkOwnership(options.databaseIdentity),
      (owned) => owned.dispose,
    );
    const scheduler = yield* SyncScheduler.make(
      {
        register: () => engine.ensureRegistered(),
        drainUpload: () => engine.uploadOnce().pipe(Effect.asVoid),
        catchUp: () =>
          pullRequestFromStore(store).pipe(
            Effect.flatMap((request) => engine.downloadOnce(request)),
            Effect.asVoid,
          ),
        recover: (code) => recoverFrom(store, transport, code),
      },
      options.policy ?? defaultHttpPollPolicy,
    );
    const acquired = yield* ownership.tryAcquire(() => scheduler.setNetworkOwner(true));
    yield* Effect.addFinalizer(() =>
      scheduler.setNetworkOwner(false).pipe(Effect.andThen(acquired.release)),
    );
    yield* scheduler.wake("startup");
    if (options.live !== undefined) {
      const cursor = yield* store.readSyncCursor();
      yield* Effect.forkScoped(
        runLiveWakeLoop(transport, { ...options.live, replicaId: cursor.replicaId }, scheduler),
      );
    }
    return { engine, scheduler, ownership };
  });

const engineOptions = (policy: SyncSchedulerPolicy | undefined) => ({
  digestVerificationIntervalMillis: policy?.digestVerificationIntervalMillis,
});

export const layerOwnedHttpSync = (
  options: OwnedHttpSyncOptions,
): Layer.Layer<
  SyncEngine | SyncScheduler,
  SyncProtocolError | ReplicaStoreError,
  ReplicaStore | SyncTransportService
> =>
  Layer.effect(
    SyncScheduler,
    ownHttpSync(options).pipe(Effect.map((owned) => owned.scheduler)),
  ).pipe(Layer.provideMerge(SyncEngine.layer(engineOptions(options.policy))));

export const startOwnedHttpSync = (
  store: ReplicaStoreContract,
  transport: SyncTransport,
  databaseIdentity: string,
  live?: LiveWakeHost,
  policy: SyncSchedulerPolicy = defaultHttpPollPolicy,
): Effect.Effect<OwnedHttpSync> =>
  Effect.gen(function* () {
    const engine = yield* SyncEngine.make(engineOptions(policy));
    const { value: owned, close } = yield* withDetachedScope(
      ownHttpSync({ databaseIdentity, live, policy }).pipe(
        Effect.provideService(SyncEngine, engine),
      ),
    );
    return {
      ...owned,
      wake: (reason: SyncWakeReason = "localWrite") => owned.scheduler.wake(reason),
      dispose: close,
    } satisfies OwnedHttpSync;
  }).pipe(
    Effect.orDie,
    Effect.provideService(ReplicaStore, store),
    Effect.provideService(SyncTransportService, transport),
  );
