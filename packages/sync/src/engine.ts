import type {
  CommandReceipt,
  SyncCommandEnvelope,
  SyncLiveServerFrame,
  SyncPullRequest,
} from "@store/contracts";
import { SyncProtocolError } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { isSnapshotRequired, recoverRequiredSnapshot } from "./recovery";
import { feedAfterPull, type ReplicaFeedMode } from "./replica/apply";
import { mapReplicaStoreFailure, ReplicaCoverageRepairRequired } from "./replica/errors";
import { makeSqliteReplicaStore } from "./replica/sqlite/store";
import { ReplicaStore, type ReplicaStoreContract, type ReplicaStoreError } from "./replica/store";
import type { SqliteDatabase } from "./sqlite";
import type { SyncTransport, SyncTransportError } from "./transport";

export type SyncEngineProgress = {
  readonly uploading: boolean;
  readonly downloading: boolean;
  readonly feed: ReplicaFeedMode;
};

export type SyncEngineError =
  | SyncTransportError
  | SyncProtocolError
  | ReplicaCoverageRepairRequired
  | ReplicaStoreError;

export interface SyncEngineContract {
  readonly progress: SubscriptionRef.SubscriptionRef<SyncEngineProgress>;
  readonly saveCommand: (
    envelope: SyncCommandEnvelope,
    createdAt: number,
  ) => Effect.Effect<void, SyncProtocolError | ReplicaStoreError>;
  readonly uploadOnce: () => Effect.Effect<CommandReceipt | undefined, SyncEngineError>;
  readonly downloadOnce: (request: SyncPullRequest) => Effect.Effect<string, SyncEngineError>;
  readonly applyLiveFrame: (
    frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
  ) => Effect.Effect<boolean, SyncProtocolError | ReplicaStoreError>;
  readonly verifyAuthority: (input: {
    readonly incarnation: string;
    readonly horizon: string;
  }) => Effect.Effect<void, SyncProtocolError | ReplicaStoreError>;
}

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineContract>()(
  "@store/sync/SyncEngine",
) {}

const makeClaimId = Effect.sync(() => crypto.randomUUID());

const STALE_UPLOAD_CLAIM_MILLIS = 60_000;

type SyncEngineMutex = {
  readonly withPermits: (
    permits: number,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

const makeSyncEngineFromStore = (
  store: ReplicaStoreContract,
  mutex: SyncEngineMutex,
  transport: SyncTransport,
): Effect.Effect<SyncEngineContract, SyncProtocolError | ReplicaStoreError> =>
  Effect.gen(function* () {
    const progress = yield* SubscriptionRef.make<SyncEngineProgress>({
      uploading: false,
      downloading: false,
      feed: { _tag: "catchingUp", targetCommitSequence: "0" },
    });
    const withPermit = <A, E>(effect: Effect.Effect<A, E>) => mutex.withPermits(1)(effect);

    const startedAt = yield* Clock.currentTimeMillis;
    yield* withPermit(store.recoverStaleUploadClaims(startedAt - STALE_UPLOAD_CLAIM_MILLIS));

    const saveCommand = Effect.fn("SyncEngine.saveCommand")(function* (
      envelope: SyncCommandEnvelope,
      createdAt: number,
    ) {
      yield* withPermit(store.enqueueCommand(envelope, createdAt)).pipe(
        Effect.mapError(mapReplicaStoreFailure),
      );
    });

    const verifyAuthority = Effect.fn("SyncEngine.verifyAuthority")(function* (input: {
      readonly incarnation: string;
      readonly horizon: string;
    }) {
      yield* withPermit(store.verifyAuthority(input)).pipe(Effect.mapError(mapReplicaStoreFailure));
    });

    const uploadOnce = Effect.fn("SyncEngine.uploadOnce")(function* () {
      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          const claimedAt = yield* Clock.currentTimeMillis;
          const claimId = yield* makeClaimId;
          const claimed = yield* withPermit(store.claimNextUpload({ claimId, claimedAt })).pipe(
            Effect.mapError(mapReplicaStoreFailure),
          );
          if (claimed.value) {
            yield* SubscriptionRef.update(progress, (current) => ({ ...current, uploading: true }));
          }
          return claimed.value;
        }),
        (activeClaim) =>
          Effect.gen(function* () {
            if (!activeClaim) return undefined;
            if (activeClaim.outcomeUncertain) {
              const existing = yield* transport.getReceipt(activeClaim.envelope.operationId);
              if (existing) {
                yield* withPermit(store.settleUploadClaim(activeClaim.claimId, existing)).pipe(
                  Effect.mapError(mapReplicaStoreFailure),
                );
                return existing;
              }
            }
            const receipt = yield* transport.submitCommand(activeClaim.envelope);
            yield* withPermit(store.settleUploadClaim(activeClaim.claimId, receipt)).pipe(
              Effect.mapError(mapReplicaStoreFailure),
            );
            return receipt;
          }),
        (activeClaim) =>
          activeClaim
            ? withPermit(
                store.releaseUploadClaim(activeClaim.operationId, activeClaim.claimId),
              ).pipe(
                Effect.mapError(mapReplicaStoreFailure),
                Effect.ensuring(
                  SubscriptionRef.update(progress, (current) => ({
                    ...current,
                    uploading: false,
                  })),
                ),
              )
            : Effect.void,
      );
    });

    const downloadOnce = Effect.fn("SyncEngine.downloadOnce")(function* (request: SyncPullRequest) {
      yield* SubscriptionRef.update(progress, (current) => ({ ...current, downloading: true }));
      return yield* Effect.gen(function* () {
        const pulled = yield* transport.pull(request).pipe(
          Effect.catchIf(isSnapshotRequired, () =>
            Effect.gen(function* () {
              yield* recoverRequiredSnapshot(transport, store, {
                epoch: request.epoch,
                subscription: request.subscription,
              });
              return yield* transport.pull(request);
            }),
          ),
        );
        const applied = yield* withPermit(store.applyRemotePage(pulled)).pipe(
          Effect.mapError(mapReplicaStoreFailure),
        );
        if (applied.value.repairRequired) {
          yield* withPermit(store.markCoverageRepair(pulled.subscription)).pipe(
            Effect.mapError(mapReplicaStoreFailure),
          );
          return yield* Effect.fail(
            ReplicaCoverageRepairRequired.make({ subscription: pulled.subscription }),
          );
        }
        const nextFeed = feedAfterPull(
          yield* SubscriptionRef.get(progress).pipe(Effect.map((current) => current.feed)),
          pulled,
          applied.value.appliedThrough,
        );
        yield* SubscriptionRef.update(progress, (current) => ({
          ...current,
          feed: nextFeed,
        }));
        return applied.value.appliedThrough;
      }).pipe(
        Effect.ensuring(
          SubscriptionRef.update(progress, (current) => ({ ...current, downloading: false })),
        ),
      );
    });

    const applyLiveFrameEffect = Effect.fn("SyncEngine.applyLiveFrame")(function* (
      frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
    ) {
      const feed = yield* SubscriptionRef.get(progress).pipe(Effect.map((current) => current.feed));
      if (feed._tag !== "following") return false;
      yield* Effect.forEach(
        frame.transactions,
        (group) =>
          withPermit(store.applyTransactionGroup(group)).pipe(
            Effect.mapError(mapReplicaStoreFailure),
          ),
        { discard: true },
      );
      return true;
    });

    return {
      progress,
      saveCommand,
      uploadOnce,
      downloadOnce,
      applyLiveFrame: applyLiveFrameEffect,
      verifyAuthority,
    };
  });

export const makeSyncEngine = (
  db: SqliteDatabase,
  mutex: SyncEngineMutex,
  transport: SyncTransport,
): Effect.Effect<SyncEngineContract, SyncProtocolError | ReplicaStoreError> =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(db, "sqlite");
    return yield* makeSyncEngineFromStore(store, mutex, transport);
  });

export const makeSyncEngineFromReplicaStore = (
  store: ReplicaStoreContract,
  mutex: SyncEngineMutex,
  transport: SyncTransport,
): Effect.Effect<SyncEngineContract, SyncProtocolError | ReplicaStoreError> =>
  makeSyncEngineFromStore(store, mutex, transport);

export { ReplicaStore };
