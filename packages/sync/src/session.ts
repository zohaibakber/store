import {
  OPERATIONAL_SUBSCRIPTION,
  syncProtocolError,
  type DeviceLabel,
  type SyncProtocolCode,
  type SyncProtocolError,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { cursorFromStore, SyncEngine } from "./engine";
import { makeLiveSocket, type LiveSocketHost } from "./live-socket";
import { recoverRequiredSnapshot, type SnapshotRecoveryError } from "./recovery";
import { SyncRecoveryRequired } from "./replica/errors";
import { ReplicaStore, type ReplicaStoreContract, type ReplicaStoreError } from "./replica/store";
import {
  defaultHttpPollPolicy,
  SyncScheduler,
  type SyncSchedulerContract,
  type SyncSchedulerPolicy,
} from "./scheduler";
import { SyncTransportService, type SyncTransport } from "./transport";
import { ownWebNetwork } from "./web-ownership";

export type OwnedLiveHost = Omit<LiveSocketHost, "replicaId">;

type OwnedHttpSyncOptions = {
  readonly databaseIdentity: string;
  readonly live: OwnedLiveHost;
  readonly policy?: SyncSchedulerPolicy;
  readonly deviceLabel?: DeviceLabel | undefined;
};

const recoverFrom = (
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

const CLAIMED_AT_ANY_TIME = Number.POSITIVE_INFINITY;

const releaseAbandonedClaims = (store: ReplicaStoreContract): Effect.Effect<void> =>
  store.recoverStaleUploadClaims(CLAIMED_AT_ANY_TIME).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Upload claims left by an earlier owner could not be released", error),
    ),
    Effect.asVoid,
  );

const ownHttpSync = (
  options: OwnedHttpSyncOptions,
): Effect.Effect<
  SyncSchedulerContract,
  ReplicaStoreError,
  ReplicaStore | SyncTransportService | SyncEngine | Scope.Scope
> =>
  Effect.gen(function* () {
    const store = yield* ReplicaStore;
    const transport = yield* SyncTransportService;
    const engine = yield* SyncEngine;
    const inner = yield* SyncScheduler.make(
      {
        register: () => engine.ensureRegistered(),
        drainUpload: () => engine.drainUploads().pipe(Effect.asVoid),
        catchUp: () => engine.catchUp(),
        recover: (code) => recoverFrom(store, transport, code),
        hintApplied: (hint) => engine.hintApplied(hint).pipe(Effect.orElseSucceed(() => false)),
      },
      options.policy ?? defaultHttpPollPolicy,
    );
    const owner = yield* SubscriptionRef.make(false);
    const cursor = yield* store.readSyncCursor();
    const live = yield* makeLiveSocket(
      { ...options.live, replicaId: cursor.replicaId },
      {
        onFrame: (frame) =>
          engine.applyLiveFrame(frame).pipe(
            Effect.flatMap((outcome) =>
              outcome._tag === "pull" ? inner.wake("live", outcome.hint) : Effect.void,
            ),
            Effect.catch(() => inner.wake("live")),
          ),
        setConnected: inner.setLiveConnected,
        maxBytes: engine.pullMaxBytes,
      },
    );
    const scheduler: SyncSchedulerContract = {
      ...inner,
      wake: (reason, hint) =>
        inner
          .wake(reason, hint)
          .pipe(
            Effect.andThen(reason === "focus" || reason === "reconnect" ? live.nudge : Effect.void),
          ),
      setNetworkOwner: (owned) =>
        inner.setNetworkOwner(owned).pipe(Effect.andThen(SubscriptionRef.set(owner, owned))),
    };
    yield* ownWebNetwork(
      options.databaseIdentity,
      releaseAbandonedClaims(store).pipe(Effect.andThen(scheduler.setNetworkOwner(true))),
    );
    yield* Effect.addFinalizer(() => scheduler.setNetworkOwner(false));
    yield* scheduler.wake("startup");
    const liveLoop = engine.awaitRegistered.pipe(
      Effect.andThen(live.run),
      Effect.ensuring(inner.setLiveConnected(false)),
    );
    yield* SubscriptionRef.changes(owner).pipe(
      Stream.changes,
      Stream.switchMap((owned) => (owned ? Stream.fromEffect(liveLoop) : Stream.empty)),
      Stream.runDrain,
      Effect.forkScoped,
    );
    return scheduler;
  });

const engineOptions = (policy: SyncSchedulerPolicy | undefined, deviceLabel?: DeviceLabel) => ({
  digestVerificationIntervalMillis: policy?.digestVerificationIntervalMillis,
  pullMaxBytes: policy?.pullMaxBytes,
  deviceLabel,
});

export const layerOwnedHttpSync = (
  options: OwnedHttpSyncOptions,
): Layer.Layer<
  SyncEngine | SyncScheduler,
  SyncProtocolError | ReplicaStoreError,
  ReplicaStore | SyncTransportService
> =>
  Layer.effect(SyncScheduler, ownHttpSync(options)).pipe(
    Layer.provideMerge(SyncEngine.layer(engineOptions(options.policy, options.deviceLabel))),
  );

const LOCAL_SYNC_POLICY: SyncSchedulerPolicy = {
  activePollMillis: Number.POSITIVE_INFINITY,
  backoffMillis: [],
  hiddenPollMillis: Number.POSITIVE_INFINITY,
  liveIdlePollMillis: Number.POSITIVE_INFINITY,
  digestVerificationIntervalMillis: "never",
};

const ownLocalSync: Effect.Effect<
  SyncSchedulerContract,
  ReplicaStoreError,
  ReplicaStore | SyncEngine | Scope.Scope
> = Effect.gen(function* () {
  const store = yield* ReplicaStore;
  const engine = yield* SyncEngine;
  yield* releaseAbandonedClaims(store);
  const cursor = yield* store.readSyncCursor();
  if (!cursor.bootstrapped) yield* store.recordCaughtUp(yield* Clock.currentTimeMillis);
  const scheduler = yield* SyncScheduler.make(
    {
      register: () => engine.ensureRegistered(),
      drainUpload: () => engine.drainUploads().pipe(Effect.asVoid),
      catchUp: () => engine.catchUp(),
    },
    LOCAL_SYNC_POLICY,
  );
  yield* scheduler.setNetworkOwner(true);
  return scheduler;
});

export const layerOwnedLocalSync: Layer.Layer<
  SyncEngine | SyncScheduler,
  SyncProtocolError | ReplicaStoreError,
  ReplicaStore | SyncTransportService
> = Layer.effect(SyncScheduler, ownLocalSync).pipe(
  Layer.provideMerge(SyncEngine.layer(engineOptions(LOCAL_SYNC_POLICY))),
);
