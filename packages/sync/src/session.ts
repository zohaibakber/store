import type { DeviceLabel, SyncProtocolError } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { SyncEngine } from "./engine";
import { makeLiveSocket, type LiveSocketHost } from "./live-socket";
import { ReplicaStore, type ReplicaStoreError } from "./replica/store";
import { defaultHttpPollPolicy, SyncScheduler, type SyncSchedulerPolicy } from "./scheduler";
import { SyncStateRef } from "./sync-state";
import type { SyncTransport } from "./transport";
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
  SyncScheduler["Service"],
  ReplicaStoreError,
  ReplicaStore | SyncEngine | SyncScheduler | Scope.Scope
> =>
  Effect.gen(function* () {
    const store = yield* ReplicaStore;
    const engine = yield* SyncEngine;
    const inner = yield* SyncScheduler;
    const cursor = yield* store.readSyncCursor;
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
        maxBytes: Effect.succeed(options.policy?.pullMaxBytes),
      },
    );
    const scheduler: SyncScheduler["Service"] = {
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
    yield* engine.state.pipe(
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
  ReplicaStore | SyncTransport | Crypto.Crypto
> =>
  Layer.effect(SyncScheduler, ownHttpSync(options)).pipe(
    Layer.provide(SyncScheduler.layer(options.policy ?? defaultHttpPollPolicy)),
    Layer.provideMerge(SyncEngine.layer(engineOptions(options.policy, options.deviceLabel))),
    Layer.provide(Layer.fresh(SyncStateRef.layer)),
  );

const LOCAL_SYNC_POLICY: SyncSchedulerPolicy = {
  activePoll: Duration.infinity,
  hiddenPoll: Duration.infinity,
  liveIdlePoll: Duration.infinity,
  digestVerificationIntervalMillis: "never",
};

const ownLocalSync: Effect.Effect<
  SyncScheduler["Service"],
  ReplicaStoreError,
  ReplicaStore | SyncScheduler
> = Effect.gen(function* () {
  const store = yield* ReplicaStore;
  const scheduler = yield* SyncScheduler;
  const cursor = yield* store.readSyncCursor;
  if (!cursor.bootstrapped) yield* store.recordCaughtUp(yield* Clock.currentTimeMillis);
  yield* scheduler.setNetworkOwner(true);
  return scheduler;
});

export const layerOwnedLocalSync: Layer.Layer<
  SyncEngine | SyncScheduler,
  SyncProtocolError | ReplicaStoreError,
  ReplicaStore | SyncTransport | Crypto.Crypto
> = Layer.effect(SyncScheduler, ownLocalSync).pipe(
  Layer.provide(SyncScheduler.layer(LOCAL_SYNC_POLICY, { recovers: false })),
  Layer.provideMerge(SyncEngine.layer(engineOptions(LOCAL_SYNC_POLICY))),
  Layer.provide(Layer.fresh(SyncStateRef.layer)),
);
