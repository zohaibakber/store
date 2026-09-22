import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  type SyncPullRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { makeSyncEngineFromReplicaStore, type SyncEngineContract } from "./engine";
import { forkLiveWakeLoop, type LiveWakeHost } from "./live-wake";
import type { ReplicaStoreContract } from "./replica/store";
import { makeSyncScheduler, type SyncScheduler, type SyncWakeReason } from "./scheduler";
import type { SyncTransport } from "./transport";
import { makeWebNetworkOwnership, type WebNetworkOwnership } from "./web-ownership";

export type OwnedHttpSync = {
  readonly engine: SyncEngineContract;
  readonly scheduler: SyncScheduler;
  readonly ownership: WebNetworkOwnership;
  readonly wake: (reason?: SyncWakeReason) => Effect.Effect<void>;
  readonly dispose: Effect.Effect<void>;
};

const pullRequestFromStore = (store: ReplicaStoreContract): Effect.Effect<SyncPullRequest, never> =>
  store.readSyncCursor().pipe(
    Effect.orDie,
    Effect.map((cursor): SyncPullRequest => ({
      epoch: Schema.decodeUnknownSync(SyncEpoch)(cursor.epoch),
      subscription: OPERATIONAL_SUBSCRIPTION,
      afterCommitSequence: OrgCommitSequence.make(cursor.appliedCommitSequence),
    })),
  );

export const startOwnedHttpSync = (
  store: ReplicaStoreContract,
  transport: SyncTransport,
  databaseIdentity: string,
  live?: LiveWakeHost,
): Effect.Effect<OwnedHttpSync> =>
  Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    const engine = yield* makeSyncEngineFromReplicaStore(store, mutex, transport).pipe(
      Effect.orDie,
    );
    const ownership = yield* makeWebNetworkOwnership(databaseIdentity);
    const scheduler = yield* makeSyncScheduler({
      drainUpload: () => engine.uploadOnce().pipe(Effect.asVoid, Effect.ignore),
      catchUp: () =>
        pullRequestFromStore(store).pipe(
          Effect.flatMap((request) => engine.downloadOnce(request)),
          Effect.asVoid,
          Effect.ignore,
        ),
    });
    const acquired = yield* ownership.tryAcquire(() => scheduler.setNetworkOwner(true));
    yield* scheduler.wake("startup");
    const liveFiber =
      live === undefined ? undefined : yield* forkLiveWakeLoop(transport, live, scheduler);

    return {
      engine,
      scheduler,
      ownership,
      wake: (reason: SyncWakeReason = "localWrite") => scheduler.wake(reason),
      dispose: Effect.gen(function* () {
        if (liveFiber) yield* Fiber.interrupt(liveFiber);
        yield* scheduler.setNetworkOwner(false);
        yield* acquired.release;
        yield* scheduler.shutdown;
        yield* ownership.dispose;
      }),
    } satisfies OwnedHttpSync;
  });
