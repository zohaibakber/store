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

import {
  applyLiveFrame,
  applyPullResult,
  feedAfterPull,
  type ReplicaFeedMode,
} from "./replica/apply";
import {
  claimNextUpload,
  recoverStaleUploadClaims,
  releaseUploadClaim,
  saveLocalCommand,
  settleUploadClaim,
  verifyAuthorityHeadNotBehind,
  verifyReplicaIncarnation,
} from "./replica/commands";
import { markCoverageRepair } from "./replica/coverage";
import { ReplicaCoverageRepairRequired, ReplicaStorageError } from "./replica/errors";
import { runReplicaTransaction, type ReplicaDb } from "./replica/storage";
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
  | ReplicaStorageError
  | ReplicaCoverageRepairRequired;

export interface SyncEngineContract {
  readonly progress: SubscriptionRef.SubscriptionRef<SyncEngineProgress>;
  readonly saveCommand: (
    envelope: SyncCommandEnvelope,
    createdAt: number,
  ) => Effect.Effect<void, ReplicaStorageError>;
  readonly uploadOnce: () => Effect.Effect<CommandReceipt | undefined, SyncEngineError>;
  readonly downloadOnce: (request: SyncPullRequest) => Effect.Effect<string, SyncEngineError>;
  readonly applyLiveFrame: (
    frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
  ) => Effect.Effect<boolean, ReplicaStorageError>;
  readonly verifyAuthority: (input: {
    readonly incarnation: string;
    readonly horizon: string;
  }) => Effect.Effect<void, SyncProtocolError | ReplicaStorageError>;
}

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineContract>()(
  "@store/sync/SyncEngine",
) {}

const makeClaimId = Effect.sync(() => crypto.randomUUID());

const STALE_UPLOAD_CLAIM_MILLIS = 60_000;

export const makeSyncEngine = (
  db: SqliteDatabase,
  mutex: {
    readonly withPermits: (
      permits: number,
    ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  },
  transport: SyncTransport,
): Effect.Effect<SyncEngineContract> =>
  Effect.gen(function* () {
    const progress = yield* SubscriptionRef.make<SyncEngineProgress>({
      uploading: false,
      downloading: false,
      feed: { _tag: "catchingUp", targetCommitSequence: "0" },
    });
    const withPermit = <A>(run: (tx: ReplicaDb) => A) =>
      mutex.withPermits(1)(Effect.sync(() => runReplicaTransaction(db, run)));

    const startedAt = yield* Clock.currentTimeMillis;
    yield* withPermit((tx) => {
      recoverStaleUploadClaims(tx, startedAt - STALE_UPLOAD_CLAIM_MILLIS);
    });

    const saveCommand = Effect.fn("SyncEngine.saveCommand")(function* (
      envelope: SyncCommandEnvelope,
      createdAt: number,
    ) {
      yield* withPermit((tx) => {
        saveLocalCommand(tx, envelope, createdAt);
      });
    });

    const verifyAuthority = Effect.fn("SyncEngine.verifyAuthority")(function* (input: {
      readonly incarnation: string;
      readonly horizon: string;
    }) {
      yield* withPermit((tx) => {
        verifyReplicaIncarnation(tx, input.incarnation);
        verifyAuthorityHeadNotBehind(tx, input.horizon);
      });
    });

    const uploadOnce = Effect.fn("SyncEngine.uploadOnce")(function* () {
      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          const claimedAt = yield* Clock.currentTimeMillis;
          const claimId = yield* makeClaimId;
          const claim = yield* withPermit((tx) => claimNextUpload(tx, { claimId, claimedAt }));
          if (claim) {
            yield* SubscriptionRef.update(progress, (current) => ({ ...current, uploading: true }));
          }
          return claim;
        }),
        (activeClaim) =>
          Effect.gen(function* () {
            if (!activeClaim) return undefined;
            if (activeClaim.outcomeUncertain) {
              const existing = yield* transport.getReceipt(activeClaim.envelope.operationId);
              if (existing) {
                yield* withPermit((tx) => settleUploadClaim(tx, activeClaim.claimId, existing));
                return existing;
              }
            }
            const receipt = yield* transport.submitCommand(activeClaim.envelope);
            yield* withPermit((tx) => settleUploadClaim(tx, activeClaim.claimId, receipt));
            return receipt;
          }),
        (activeClaim) =>
          activeClaim
            ? withPermit((tx) => {
                releaseUploadClaim(tx, activeClaim.operationId, activeClaim.claimId);
              }).pipe(
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
        const pulled = yield* transport.pull(request);
        const applied = yield* withPermit((tx) => {
          verifyReplicaIncarnation(tx, pulled.incarnation);
          return applyPullResult(tx, pulled);
        });
        if (applied.repairRequired) {
          yield* withPermit((tx) => {
            markCoverageRepair(tx, pulled.subscription);
          });
          return yield* Effect.fail(
            ReplicaCoverageRepairRequired.make({ subscription: pulled.subscription }),
          );
        }
        const nextFeed = feedAfterPull(
          yield* SubscriptionRef.get(progress).pipe(Effect.map((current) => current.feed)),
          pulled,
          applied.appliedThrough,
        );
        yield* SubscriptionRef.update(progress, (current) => ({
          ...current,
          feed: nextFeed,
        }));
        return applied.appliedThrough;
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
      return yield* withPermit((tx) => applyLiveFrame(tx, feed, frame));
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
