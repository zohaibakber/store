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
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { isSnapshotRequired, recoverRequiredSnapshot } from "./recovery";
import { shouldRecordCaughtUp } from "./replica/activity";
import { feedAfterPull, type ReplicaFeedMode } from "./replica/apply";
import {
  DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS,
  shouldRequestDigest,
} from "./replica/digest-cadence";
import { ReplicaCoverageRepairRequired, SyncRecoveryRequired } from "./replica/errors";
import { ReplicaStore, type ReplicaStoreContract, type ReplicaStoreError } from "./replica/store";
import { SyncTransportService, type SyncTransport, type SyncTransportError } from "./transport";

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
  readonly ensureRegistered: () => Effect.Effect<void, SyncEngineError | SyncRecoveryRequired>;
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

const makeClaimId = Effect.sync(() => crypto.randomUUID());

const STALE_UPLOAD_CLAIM_MILLIS = 60_000;

export type SyncEngineMutex = {
  readonly withPermits: (
    permits: number,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

export type SyncEngineOptions = {
  readonly digestVerificationIntervalMillis?: number;
};

export const makeSyncEngineFromReplicaStore = (
  store: ReplicaStoreContract,
  mutex: SyncEngineMutex,
  transport: SyncTransport,
  options: SyncEngineOptions = {},
): Effect.Effect<SyncEngineContract, SyncProtocolError | ReplicaStoreError> =>
  Effect.gen(function* () {
    const digestIntervalMillis =
      options.digestVerificationIntervalMillis ?? DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS;
    const believesCaughtUp = yield* Ref.make(true);
    const caughtUpRecordedAt = yield* Ref.make<number | undefined>(undefined);
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
      yield* withPermit(store.enqueueCommand(envelope, createdAt));
    });

    const registered = yield* Ref.make(false);

    const ensureRegistered = Effect.fn("SyncEngine.ensureRegistered")(function* () {
      if (yield* Ref.get(registered)) return;
      const cursor = yield* withPermit(store.readSyncCursor());
      if (!cursor.registered) {
        const authority = yield* transport.registerReplica({ replicaId: cursor.replicaId });
        const registeredAt = yield* Clock.currentTimeMillis;
        const outcome = yield* withPermit(store.adoptRegistration(authority, registeredAt));
        if (outcome._tag === "refused") {
          return yield* Effect.fail(
            SyncRecoveryRequired.make({ code: outcome.code, message: outcome.message }),
          );
        }
      }
      yield* Ref.set(registered, true);
    });

    const verifyAuthority = Effect.fn("SyncEngine.verifyAuthority")(function* (input: {
      readonly incarnation: string;
      readonly horizon: string;
    }) {
      yield* withPermit(store.verifyAuthority(input));
    });

    const uploadOnce = Effect.fn("SyncEngine.uploadOnce")(function* () {
      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          const claimedAt = yield* Clock.currentTimeMillis;
          const claimId = yield* makeClaimId;
          const claimed = yield* withPermit(store.claimNextUpload({ claimId, claimedAt }));
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
                yield* withPermit(store.settleUploadClaim(activeClaim.claimId, existing));
                return existing;
              }
            }
            const receipt = yield* transport.submitCommand(activeClaim.envelope);
            yield* withPermit(store.settleUploadClaim(activeClaim.claimId, receipt));
            return receipt;
          }),
        (activeClaim) =>
          activeClaim
            ? withPermit(
                store.releaseUploadClaim(activeClaim.operationId, activeClaim.claimId),
              ).pipe(
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
        const pulledAt = yield* Clock.currentTimeMillis;
        const lastVerifiedAt = yield* withPermit(
          store.readDigestVerification(request.subscription),
        );
        const includeDigest = shouldRequestDigest({
          believesCaughtUp: yield* Ref.get(believesCaughtUp),
          lastVerifiedAtMillis: lastVerifiedAt,
          nowMillis: pulledAt,
          intervalMillis: digestIntervalMillis,
        });
        const pullRequest = includeDigest ? { ...request, includeDigest: true } : request;
        const pulled = yield* transport.pull(pullRequest).pipe(
          Effect.catchIf(isSnapshotRequired, () =>
            Effect.gen(function* () {
              const cursor = yield* withPermit(store.readSyncCursor());
              yield* recoverRequiredSnapshot(transport, store, {
                epoch: request.epoch,
                subscription: request.subscription,
                replicaId: cursor.replicaId,
              });
              return yield* transport.pull(pullRequest);
            }),
          ),
        );
        const applied = yield* withPermit(store.applyRemotePage(pulled));
        if (applied.value.repairRequired) {
          yield* withPermit(store.markCoverageRepair(pulled.subscription));
          return yield* Effect.fail(
            ReplicaCoverageRepairRequired.make({ subscription: pulled.subscription }),
          );
        }
        const nextFeed = feedAfterPull(pulled, applied.value.appliedThrough);
        yield* SubscriptionRef.update(progress, (current) => ({
          ...current,
          feed: nextFeed,
        }));
        yield* Ref.set(believesCaughtUp, nextFeed._tag === "following");
        if (pulled.digest !== undefined && applied.value.digestVerified !== false) {
          yield* withPermit(store.recordDigestVerification(pulled.subscription, pulledAt));
        }
        if (nextFeed._tag === "following") {
          const caughtUpAt = yield* Clock.currentTimeMillis;
          if (shouldRecordCaughtUp(yield* Ref.get(caughtUpRecordedAt), caughtUpAt)) {
            yield* withPermit(store.recordCaughtUp(caughtUpAt));
            yield* Ref.set(caughtUpRecordedAt, caughtUpAt);
          }
        }
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
        (group) => withPermit(store.applyTransactionGroup(group)),
        { discard: true },
      );
      return true;
    });

    return {
      progress,
      ensureRegistered,
      saveCommand,
      uploadOnce,
      downloadOnce,
      applyLiveFrame: applyLiveFrameEffect,
      verifyAuthority,
    };
  });

const makeSyncEngineFromContext = (options?: SyncEngineOptions) =>
  Effect.gen(function* () {
    const store = yield* ReplicaStore;
    const transport = yield* SyncTransportService;
    const mutex = yield* Semaphore.make(1);
    return yield* makeSyncEngineFromReplicaStore(store, mutex, transport, options);
  });

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineContract>()(
  "@store/sync/SyncEngine",
) {
  static readonly make = makeSyncEngineFromContext;

  static readonly layer = (options?: SyncEngineOptions) =>
    Layer.effect(SyncEngine, makeSyncEngineFromContext(options));
}
