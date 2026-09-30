import {
  compareDecimalSequence,
  incrementDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  SyncEpoch,
  SyncProtocolError,
  type CommandReceipt,
  type EnqueueCommandRequest,
  type SyncCommandEnvelope,
  type SyncLiveServerFrame,
  type SyncLiveWakeHint,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncSubmitCommandRequest,
  type SyncSubmitCommandResult,
  type SyncSubscription,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { isSnapshotRequired, recoverRequiredSnapshot } from "./recovery";
import { CAUGHT_UP_RECORD_INTERVAL_MILLIS } from "./replica/activity";
import { feedAfterPull, type ReplicaFeedMode } from "./replica/apply";
import { DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS, dueSince } from "./replica/cadence";
import {
  ReplicaCoverageRepairRequired,
  ReplicaStorageError,
  SyncRecoveryRequired,
} from "./replica/errors";
import {
  ReplicaStore,
  type AppliedCursor,
  type QueuedCommand,
  type ReplicaStoreContract,
  type ReplicaStoreError,
} from "./replica/store";
import type { SyncCatchUpOutcome } from "./scheduler";
import { SyncTransportService, type SyncTransport, type SyncTransportError } from "./transport";

type SyncEngineProgress = {
  readonly uploading: boolean;
  readonly downloading: boolean;
  readonly feed: ReplicaFeedMode;
};

type SyncEngineError =
  | SyncTransportError
  | SyncProtocolError
  | ReplicaCoverageRepairRequired
  | ReplicaStoreError;

type LiveFrameOutcome =
  | { readonly _tag: "applied" }
  | { readonly _tag: "current" }
  | { readonly _tag: "pull"; readonly hint?: SyncLiveWakeHint };

const LIVE_APPLIED: LiveFrameOutcome = { _tag: "applied" };
const LIVE_CURRENT: LiveFrameOutcome = { _tag: "current" };

const livePull = (epoch: SyncEpoch, horizon: OrgCommitSequence): LiveFrameOutcome => ({
  _tag: "pull",
  hint: { epoch, subscription: OPERATIONAL_SUBSCRIPTION, horizon },
});

const LIVE_RESUME: LiveFrameOutcome = { _tag: "pull" };

type TransactionsFrame = Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>;

const contiguousFrom = (frame: TransactionsFrame, appliedCommitSequence: string): boolean => {
  if (frame.fromCommitSequence !== incrementDecimalSequence(appliedCommitSequence)) return false;
  let expected: string = frame.fromCommitSequence;
  for (const group of frame.transactions) {
    if (group.commitSequence !== expected) return false;
    expected = incrementDecimalSequence(expected);
  }
  return frame.transactions.at(-1)?.commitSequence === frame.toCommitSequence;
};

interface SyncEngineContract {
  readonly progress: SubscriptionRef.SubscriptionRef<SyncEngineProgress>;
  readonly ensureRegistered: () => Effect.Effect<void, SyncEngineError | SyncRecoveryRequired>;
  readonly saveCommand: (
    request: EnqueueCommandRequest,
  ) => Effect.Effect<QueuedCommand, SyncProtocolError | ReplicaStoreError>;
  readonly uploadOnce: () => Effect.Effect<CommandReceipt | undefined, SyncEngineError>;
  readonly drainUploads: () => Effect.Effect<number, SyncEngineError>;
  readonly downloadOnce: (request: SyncPullRequest) => Effect.Effect<string, SyncEngineError>;
  readonly catchUp: () => Effect.Effect<SyncCatchUpOutcome, SyncEngineError>;
  readonly hintApplied: (hint: SyncLiveWakeHint) => Effect.Effect<boolean, ReplicaStoreError>;
  readonly applyLiveFrame: (
    frame: SyncLiveServerFrame,
  ) => Effect.Effect<LiveFrameOutcome, ReplicaStoreError>;
  readonly verifyAuthority: (input: {
    readonly incarnation: string;
    readonly horizon: string;
  }) => Effect.Effect<void, SyncProtocolError | ReplicaStoreError>;
  readonly setPullMaxBytes: (maxBytes: number | undefined) => Effect.Effect<void>;
  readonly pullMaxBytes: Effect.Effect<number | undefined>;
}

const makeClaimId = Effect.sync(() => crypto.randomUUID());

const decodeEpoch = Schema.decodeUnknownEffect(SyncEpoch);

export const cursorFromStore = (store: ReplicaStoreContract) =>
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

const STALE_UPLOAD_CLAIM_MILLIS = 60_000;

export type SyncEngineMutex = {
  readonly withPermits: (
    permits: number,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

type SyncEngineOptions = {
  readonly digestVerificationIntervalMillis?: number;
  readonly pullMaxBytes?: number;
};

const withMaxBytes = <R extends object>(request: R, maxBytes: number | undefined) =>
  maxBytes === undefined ? request : { ...request, maxBytes };

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
    const pullMaxBytes = yield* Ref.make(options.pullMaxBytes);
    const uploadReachedHorizon = yield* Ref.make<string | undefined>(undefined);
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
      request: EnqueueCommandRequest,
    ) {
      return (yield* withPermit(store.enqueueCommand(request))).value;
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
            yield* Ref.set(uploadReachedHorizon, undefined);
            if (activeClaim.outcomeUncertain) {
              const existing = yield* transport.getReceipt(activeClaim.envelope.operationId);
              if (existing) {
                yield* withPermit(store.settleUploadClaim(activeClaim.claimId, existing));
                return existing;
              }
            }
            const submitted = yield* transport.submitCommand(
              yield* submitRequestFor(activeClaim.envelope),
            );
            return yield* settleSubmitted(activeClaim.claimId, submitted);
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

    const digestDue = Effect.fn("SyncEngine.digestDue")(function* (
      subscription: SyncSubscription,
      now: number,
    ) {
      const lastVerifiedAt = yield* withPermit(store.readDigestVerification(subscription));
      return (
        (yield* Ref.get(believesCaughtUp)) && dueSince(lastVerifiedAt, now, digestIntervalMillis)
      );
    });

    const recordAppliedPage = Effect.fn("SyncEngine.recordAppliedPage")(function* (
      pulled: SyncPullResult,
      applied: AppliedCursor,
      pulledAt: number,
    ) {
      if (applied.repairRequired) {
        yield* withPermit(store.markCoverageRepair(pulled.subscription));
        return yield* Effect.fail(
          ReplicaCoverageRepairRequired.make({ subscription: pulled.subscription }),
        );
      }
      const nextFeed = feedAfterPull(pulled, applied.appliedThrough);
      yield* SubscriptionRef.update(progress, (current) => ({
        ...current,
        feed: nextFeed,
      }));
      yield* Ref.set(believesCaughtUp, nextFeed._tag === "following");
      if (pulled.digest !== undefined && applied.digestVerified !== false) {
        yield* withPermit(store.recordDigestVerification(pulled.subscription, pulledAt));
      }
      if (nextFeed._tag === "following") {
        const caughtUpAt = yield* Clock.currentTimeMillis;
        const lastCaughtUpAt = yield* Ref.get(caughtUpRecordedAt);
        if (dueSince(lastCaughtUpAt, caughtUpAt, CAUGHT_UP_RECORD_INTERVAL_MILLIS)) {
          yield* withPermit(store.recordCaughtUp(caughtUpAt));
          yield* Ref.set(caughtUpRecordedAt, caughtUpAt);
        }
      }
      return nextFeed;
    });

    const submitRequestFor = Effect.fn("SyncEngine.submitRequestFor")(function* (
      envelope: SyncCommandEnvelope,
    ) {
      const cursor = yield* withPermit(cursorFromStore(store));
      const request: SyncSubmitCommandRequest = {
        ...envelope,
        afterCommitSequence: OrgCommitSequence.make(cursor.appliedCommitSequence),
      };
      return withMaxBytes(request, yield* Ref.get(pullMaxBytes));
    });

    const settleSubmitted = Effect.fn("SyncEngine.settleSubmitted")(function* (
      claimId: string,
      submitted: SyncSubmitCommandResult,
    ) {
      const { page, ...receipt } = submitted;
      if (page === undefined) {
        yield* withPermit(store.settleUploadClaim(claimId, receipt));
        return receipt;
      }
      const pulledAt = yield* Clock.currentTimeMillis;
      const applied = yield* withPermit(store.settleUploadWithPage(claimId, receipt, page)).pipe(
        Effect.map((committed) => committed.value),
        Effect.catch(() =>
          withPermit(store.settleUploadClaim(claimId, receipt)).pipe(Effect.as(undefined)),
        ),
      );
      if (applied === undefined) return receipt;
      const feed = yield* recordAppliedPage(page, applied, pulledAt);
      if (feed._tag === "following") yield* Ref.set(uploadReachedHorizon, page.horizon);
      return receipt;
    });

    const downloadOnce = Effect.fn("SyncEngine.downloadOnce")(function* (request: SyncPullRequest) {
      yield* SubscriptionRef.update(progress, (current) => ({ ...current, downloading: true }));
      return yield* Effect.gen(function* () {
        const pulledAt = yield* Clock.currentTimeMillis;
        const includeDigest = yield* digestDue(request.subscription, pulledAt);
        const digestRequest: SyncPullRequest = includeDigest
          ? { ...request, digestVersion: PARTITION_DIGEST_VERSION }
          : request;
        const pullRequest = withMaxBytes(digestRequest, yield* Ref.get(pullMaxBytes));
        const pulled = yield* transport.pull(pullRequest).pipe(
          Effect.catchIf(isSnapshotRequired, () =>
            Effect.gen(function* () {
              const cursor = yield* withPermit(store.readSyncCursor());
              yield* recoverRequiredSnapshot(transport, store, {
                epoch: request.epoch,
                subscription: request.subscription,
                replicaId: cursor.replicaId,
              });
              const recovered = yield* withPermit(pullRequestFromStore(store));
              return yield* transport.pull(
                withMaxBytes(
                  includeDigest
                    ? { ...recovered, digestVersion: PARTITION_DIGEST_VERSION }
                    : recovered,
                  yield* Ref.get(pullMaxBytes),
                ),
              );
            }),
          ),
        );
        const applied = yield* withPermit(store.applyRemotePage(pulled));
        yield* recordAppliedPage(pulled, applied.value, pulledAt);
        return applied.value.appliedThrough;
      }).pipe(
        Effect.ensuring(
          SubscriptionRef.update(progress, (current) => ({ ...current, downloading: false })),
        ),
      );
    });

    const drainUploads = Effect.fn("SyncEngine.drainUploads")(function* () {
      yield* Ref.set(uploadReachedHorizon, undefined);
      const settled = new Set<string>();
      while (true) {
        const receipt = yield* uploadOnce();
        if (receipt === undefined || settled.has(receipt.operationId)) return settled.size;
        settled.add(receipt.operationId);
      }
    });

    const uploadLeftReplicaCaughtUp = Effect.fn("SyncEngine.uploadLeftReplicaCaughtUp")(
      function* () {
        const horizon = yield* Ref.getAndSet(uploadReachedHorizon, undefined);
        if (horizon === undefined) return false;
        const cursor = yield* withPermit(store.readSyncCursor());
        if (compareDecimalSequence(cursor.appliedCommitSequence, horizon) < 0) return false;
        const now = yield* Clock.currentTimeMillis;
        return !(yield* digestDue(OPERATIONAL_SUBSCRIPTION, now));
      },
    );

    const catchUp = Effect.fn("SyncEngine.catchUp")(function* () {
      if (yield* uploadLeftReplicaCaughtUp()) return "advanced";
      let outcome: SyncCatchUpOutcome = "unchanged";
      while (true) {
        const request = yield* withPermit(pullRequestFromStore(store));
        const appliedThrough = yield* downloadOnce(request);
        const moved = compareDecimalSequence(appliedThrough, request.afterCommitSequence) > 0;
        if (moved) outcome = "advanced";
        const { feed } = yield* SubscriptionRef.get(progress);
        if (!moved || feed._tag === "following") return outcome;
      }
    });

    const hintApplied = Effect.fn("SyncEngine.hintApplied")(function* (hint: SyncLiveWakeHint) {
      const cursor = yield* withPermit(store.readSyncCursor());
      return (
        cursor.epoch === hint.epoch &&
        compareDecimalSequence(hint.horizon, cursor.appliedCommitSequence) <= 0
      );
    });

    const applyTransactionsFrame = (frame: TransactionsFrame) =>
      withPermit(
        Effect.gen(function* () {
          const cursor = yield* cursorFromStore(store);
          if (cursor.epoch !== frame.epoch) return livePull(frame.epoch, frame.toCommitSequence);
          if (compareDecimalSequence(frame.toCommitSequence, cursor.appliedCommitSequence) <= 0) {
            return LIVE_CURRENT;
          }
          if (!contiguousFrom(frame, cursor.appliedCommitSequence)) {
            return livePull(frame.epoch, frame.toCommitSequence);
          }
          for (const group of frame.transactions) {
            yield* store.applyTransactionGroup(group);
          }
          return LIVE_APPLIED;
        }),
      );

    const applyLiveFrameEffect = Effect.fn("SyncEngine.applyLiveFrame")(function* (
      frame: SyncLiveServerFrame,
    ) {
      switch (frame._tag) {
        case "resume":
          return LIVE_RESUME;
        case "hello":
        case "wake": {
          const hint = {
            epoch: frame.epoch,
            subscription: OPERATIONAL_SUBSCRIPTION,
            horizon: frame.horizon,
          };
          return (yield* hintApplied(hint)) ? LIVE_CURRENT : livePull(frame.epoch, frame.horizon);
        }
        case "transactions": {
          const { feed } = yield* SubscriptionRef.get(progress);
          if (feed._tag !== "following") return livePull(frame.epoch, frame.toCommitSequence);
          return yield* applyTransactionsFrame(frame);
        }
      }
    });

    return {
      progress,
      ensureRegistered,
      saveCommand,
      uploadOnce,
      drainUploads,
      downloadOnce,
      catchUp,
      hintApplied,
      applyLiveFrame: applyLiveFrameEffect,
      verifyAuthority,
      setPullMaxBytes: (maxBytes) => Ref.set(pullMaxBytes, maxBytes),
      pullMaxBytes: Ref.get(pullMaxBytes),
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
