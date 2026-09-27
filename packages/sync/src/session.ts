import {
  OPERATIONAL_SUBSCRIPTION,
  syncProtocolError,
  type SyncProtocolCode,
  type SyncProtocolError,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { withDetachedScope } from "./detached-scope";
import { cursorFromStore, SyncEngine, type SyncEngineContract } from "./engine";
import { runLiveWakeLoop, type LiveWakeHost } from "./live-wake";
import { recoverRequiredSnapshot, type SnapshotRecoveryError } from "./recovery";
import { SyncRecoveryRequired } from "./replica/errors";
import { ReplicaStore, type ReplicaStoreContract, type ReplicaStoreError } from "./replica/store";
import {
  defaultHttpPollPolicy,
  SyncScheduler,
  type SyncSchedulerContract,
  type SyncSchedulerPolicy,
  type SyncWakeReason,
} from "./scheduler";
import {
  LIVE_LONG_POLL_TIMEOUT_MILLIS,
  SyncTransportOffline,
  SyncTransportService,
  type SyncTransport,
} from "./transport";
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

type LiveEligibility = {
  readonly visible: boolean;
  readonly owner: boolean;
};

const withResponseDeadline =
  (fetch: typeof globalThis.fetch, millis: number): typeof globalThis.fetch =>
  (input, init) =>
    Effect.runPromise(
      Effect.tryPromise({
        try: (signal) => fetch(input, { ...init, signal }),
        catch: (cause) =>
          SyncTransportOffline.make({
            message: cause instanceof Error ? cause.message : "The live wake request failed.",
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: millis,
          orElse: () =>
            Effect.fail(
              SyncTransportOffline.make({
                message: `The live wake request did not answer within ${millis} ms.`,
              }),
            ),
        }),
      ),
      init?.signal ? { signal: init.signal } : undefined,
    );

const liveHostWithDeadline = (host: LiveWakeHost): LiveWakeHost =>
  host.preferSse
    ? host
    : { ...host, fetch: withResponseDeadline(host.fetch, LIVE_LONG_POLL_TIMEOUT_MILLIS) };

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
    const eligibility = yield* SubscriptionRef.make<LiveEligibility>({
      visible: true,
      owner: false,
    });
    const scheduler: SyncSchedulerContract = {
      ...inner,
      setVisible: (visible) =>
        inner
          .setVisible(visible)
          .pipe(
            Effect.andThen(
              SubscriptionRef.update(eligibility, (current) => ({ ...current, visible })),
            ),
          ),
      setNetworkOwner: (owner) =>
        inner
          .setNetworkOwner(owner)
          .pipe(
            Effect.andThen(
              SubscriptionRef.update(eligibility, (current) => ({ ...current, owner })),
            ),
          ),
    };
    const acquired = yield* ownership.tryAcquire(() => scheduler.setNetworkOwner(true));
    yield* Effect.addFinalizer(() =>
      scheduler.setNetworkOwner(false).pipe(Effect.andThen(acquired.release)),
    );
    yield* scheduler.wake("startup");
    if (options.live !== undefined) {
      const cursor = yield* store.readSyncCursor();
      const host = liveHostWithDeadline({ ...options.live, replicaId: cursor.replicaId });
      const liveLoop = runLiveWakeLoop(transport, host, inner).pipe(
        Effect.ensuring(inner.setLiveConnected(false)),
      );
      yield* SubscriptionRef.changes(eligibility).pipe(
        Stream.map((current) => current.visible && current.owner),
        Stream.changes,
        Stream.switchMap((eligible) => (eligible ? Stream.fromEffect(liveLoop) : Stream.empty)),
        Stream.runDrain,
        Effect.forkScoped,
      );
    }
    return { engine, scheduler, ownership };
  });

const engineOptions = (policy: SyncSchedulerPolicy | undefined) => ({
  digestVerificationIntervalMillis: policy?.digestVerificationIntervalMillis,
  pullMaxBytes: policy?.pullMaxBytes,
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
