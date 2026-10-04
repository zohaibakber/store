import type { DeviceLabel, SyncProtocolError } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { SyncEngine } from "./engine";
import { makeLiveSocket, type LiveSocketHost } from "./live-socket";
import { ReplicaStore, type ReplicaStoreError } from "./replica/store";
import {
  defaultHttpPollPolicy,
  SyncScheduler,
  type SyncSchedulerContract,
  type SyncSchedulerPolicy,
} from "./scheduler";
import type { SyncTransportService } from "./transport";
import { ownWebNetwork } from "./web-ownership";

export type OwnedLiveHost = Omit<LiveSocketHost, "replicaId">;

type OwnedHttpSyncOptions = {
  readonly databaseIdentity: string;
  readonly live: OwnedLiveHost;
  readonly policy?: SyncSchedulerPolicy;
  readonly deviceLabel?: DeviceLabel | undefined;
};

const ownHttpSync = (
  options: OwnedHttpSyncOptions,
): Effect.Effect<
  SyncSchedulerContract,
  ReplicaStoreError,
  ReplicaStore | SyncTransportService | SyncEngine | Scope.Scope
> =>
  Effect.gen(function* () {
    const store = yield* ReplicaStore;
    const engine = yield* SyncEngine;
    const inner = yield* SyncScheduler.make(
      {
        register: () => engine.ensureRegistered(),
        drainUpload: () => engine.drainUploads().pipe(Effect.asVoid),
        catchUp: () => engine.catchUp(),
        recover: (code) => engine.recover(code),
        hintApplied: (hint) => engine.hintApplied(hint).pipe(Effect.orElseSucceed(() => false)),
      },
      options.policy ?? defaultHttpPollPolicy,
      engine.state,
    );
    const cursor = yield* store.readSyncCursor();
    const live = yield* makeLiveSocket(
      { ...options.live, replicaId: cursor.replicaId },
      {
        onFrame: (frame) =>
          engine.applyLiveFrame(frame).pipe(
            Effect.flatMap((outcome) =>
              outcome._tag === "pull" ? inner.wake("live", outcome.hint) : Effect.void,
            ),
            Effect.catch((error) =>
              Effect.logWarning("sync.live_frame_failed", error).pipe(
                Effect.andThen(inner.wake("live")),
              ),
            ),
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
    };
    yield* ownWebNetwork(options.databaseIdentity, scheduler.setNetworkOwner(true));
    yield* Effect.addFinalizer(() => scheduler.setNetworkOwner(false));
    yield* scheduler.wake("startup");
    const liveLoop = engine.awaitRegistered.pipe(
      Effect.andThen(live.run),
      Effect.ensuring(inner.setLiveConnected(false)),
    );
    yield* SubscriptionRef.changes(engine.state).pipe(
      Stream.map((state) => state.owner),
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
  const cursor = yield* store.readSyncCursor();
  if (!cursor.bootstrapped) yield* store.recordCaughtUp(yield* Clock.currentTimeMillis);
  const scheduler = yield* SyncScheduler.make(
    {
      register: () => engine.ensureRegistered(),
      drainUpload: () => engine.drainUploads().pipe(Effect.asVoid),
      catchUp: () => engine.catchUp(),
    },
    LOCAL_SYNC_POLICY,
    engine.state,
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
