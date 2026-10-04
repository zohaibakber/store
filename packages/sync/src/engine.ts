import {
  compareDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  purchasingBlockedByStaleReplica,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncProtocolError,
  type AcquireSnapshotRequest,
  type CommandReceipt,
  type DeviceLabel,
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
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { isSnapshotRequired, recoverRequiredSnapshot } from "./recovery";
import { CAUGHT_UP_RECORD_INTERVAL_MILLIS } from "./replica/activity";
import type { IntegrationOutcome } from "./replica/admission-authority";
import {
  DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS,
  dueSince,
  type DigestVerificationCadence,
} from "./replica/cadence";
import {
  ReplicaCoverageRepairRequired,
  ReplicaStorageError,
  SyncRecoveryRequired,
} from "./replica/errors";
import { shouldAnnounce } from "./replica/registration";
import {
  ReplicaStore,
  type AppliedCursor,
  type Integrated,
  type QueuedCommand,
  type ReplicaStoreContract,
  type ReplicaStoreError,
} from "./replica/store";
import type { SyncCatchUpOutcome } from "./scheduler";
import {
  initialSyncState,
  isFollowing,
  restingPhase,
  withCursor,
  withRecovering,
  withRecoveryEnded,
  withTransfer,
  type SyncCursor,
  type SyncState,
} from "./sync-state";
import {
  SYNC_REQUEST_TIMEOUT_MILLIS,
  SyncTransportGarbled,
  SyncTransportService,
  type RecoverableCode,
  type SyncTransport,
  type SyncTransportError,
} from "./transport";

type SyncEngineError =
  | SyncTransportError
  | SyncProtocolError
  | ReplicaCoverageRepairRequired
  | ReplicaStoreError;

type LiveFrameOutcome =
  | { readonly _tag: "applied" }
  | { readonly _tag: "current" }
  | { readonly _tag: "pull"; readonly hint?: SyncLiveWakeHint };

type PulledPage = { readonly pulled: SyncPullResult; readonly pulledAt: number };

const LIVE_CURRENT: LiveFrameOutcome = { _tag: "current" };

const livePull = (epoch: SyncEpoch, horizon: OrgCommitSequence): LiveFrameOutcome => ({
  _tag: "pull",
  hint: { epoch, subscription: OPERATIONAL_SUBSCRIPTION, horizon },
});

const LIVE_RESUME: LiveFrameOutcome = { _tag: "pull" };

type AdmittedOutcome = Exclude<IntegrationOutcome, { readonly _tag: "refused" }>;

const admitted = (
  integrated: Integrated,
): Effect.Effect<Integrated & { readonly outcome: AdmittedOutcome }, SyncProtocolError> =>
  integrated.outcome._tag === "refused"
    ? Effect.fail(integrated.outcome.error)
    : Effect.succeed({ ...integrated, outcome: integrated.outcome });

type TransactionsFrame = Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>;

const STALE_CLAIM_MILLIS =
  SYNC_REQUEST_TIMEOUT_MILLIS.getReceipt + SYNC_REQUEST_TIMEOUT_MILLIS.submitCommand + 15_000;

interface SyncEngineContract {
  readonly state: SubscriptionRef.SubscriptionRef<SyncState>;
  readonly ensureRegistered: () => Effect.Effect<void, SyncEngineError | SyncRecoveryRequired>;
  readonly awaitRegistered: Effect.Effect<void>;
  readonly saveCommand: (
    request: EnqueueCommandRequest,
  ) => Effect.Effect<QueuedCommand, SyncProtocolError | ReplicaStoreError>;
  readonly uploadOnce: () => Effect.Effect<CommandReceipt | undefined, SyncEngineError>;
  readonly drainUploads: () => Effect.Effect<number, SyncEngineError>;
  readonly downloadOnce: (request: SyncPullRequest) => Effect.Effect<string, SyncEngineError>;
  readonly catchUp: () => Effect.Effect<SyncCatchUpOutcome, SyncEngineError>;
  readonly recover: (
    code: RecoverableCode,
  ) => Effect.Effect<void, SyncEngineError | SyncRecoveryRequired>;
  readonly hintApplied: (hint: SyncLiveWakeHint) => Effect.Effect<boolean, ReplicaStoreError>;
  readonly applyLiveFrame: (
    frame: SyncLiveServerFrame,
  ) => Effect.Effect<LiveFrameOutcome, ReplicaStoreError>;
  readonly setPullMaxBytes: (maxBytes: number | undefined) => Effect.Effect<void>;
  readonly pullMaxBytes: Effect.Effect<number | undefined>;
}

const makeClaimId = Effect.sync(() => crypto.randomUUID());

const decodeEpoch = Schema.decodeUnknownEffect(SyncEpoch);

export const cursorFromStore = (store: ReplicaStoreContract) =>
  store.readSyncCursor().pipe(
    Effect.flatMap((cursor) =>
      decodeEpoch(cursor.epoch).pipe(
        Effect.mapError((error) => new ReplicaStorageError({ message: error.message })),
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

type SyncEngineOptions = {
  readonly digestVerificationIntervalMillis?: DigestVerificationCadence;
  readonly pullMaxBytes?: number;
  readonly deviceLabel?: DeviceLabel | undefined;
};

const withMaxBytes = <R extends object>(request: R, maxBytes: number | undefined) =>
  maxBytes === undefined ? request : { ...request, maxBytes };

export const makeSyncEngineFromReplicaStore = (
  store: ReplicaStoreContract,
  transport: SyncTransport,
  options: SyncEngineOptions = {},
): Effect.Effect<SyncEngineContract> =>
  Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    const firstClaimAt = yield* Ref.make<number | undefined>(undefined);
    const digestIntervalMillis =
      options.digestVerificationIntervalMillis ?? DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS;
    const believesCaughtUp = yield* Ref.make(true);
    const pullMaxBytes = yield* Ref.make(options.pullMaxBytes);
    const uploadReachedHorizon = yield* Ref.make<string | undefined>(undefined);
    const caughtUpRecordedAt = yield* Ref.make<number | undefined>(undefined);
    const state = yield* SubscriptionRef.make(initialSyncState);
    const withPermit = <A, E>(effect: Effect.Effect<A, E>) => mutex.withPermits(1)(effect);

    const setCursor = (cursor: SyncCursor) =>
      SubscriptionRef.update(state, (current) => withCursor(current, cursor));

    const recoverSnapshot = (request: AcquireSnapshotRequest) =>
      Effect.acquireUseRelease(
        SubscriptionRef.modify(state, (current) => [current.phase, withRecovering(current)]),
        () =>
          recoverRequiredSnapshot(transport, store, request, (transfer) =>
            SubscriptionRef.update(state, (current) => withTransfer(current, transfer)),
          ),
        (previous) =>
          SubscriptionRef.update(state, (current) => withRecoveryEnded(current, previous)),
      ).pipe(
        Effect.andThen(withPermit(cursorFromStore(store))),
        Effect.flatMap((cursor) =>
          setCursor({
            epoch: cursor.epoch,
            applied: OrgCommitSequence.make(cursor.appliedCommitSequence),
          }),
        ),
      );

    const saveCommand = Effect.fn("SyncEngine.saveCommand")(function* (
      request: EnqueueCommandRequest,
    ) {
      return (yield* withPermit(store.enqueueCommand(request))).value;
    });

    const registered = yield* Deferred.make<void>();
    const heldBack = yield* Ref.make(false);

    const announce = Effect.fn("SyncEngine.announce")(function* (replicaId: string) {
      const authority = yield* transport.registerReplica({
        replicaId,
        schemaVersion: SYNC_SCHEMA_VERSION,
        ...(options.deviceLabel === undefined ? undefined : { deviceLabel: options.deviceLabel }),
      });
      const registeredAt = yield* Clock.currentTimeMillis;
      const outcome = yield* withPermit(store.adoptRegistration(authority, registeredAt));
      if (outcome._tag === "refused") {
        return yield* new SyncRecoveryRequired({ code: outcome.code, message: outcome.message });
      }
      yield* Ref.set(
        heldBack,
        purchasingBlockedByStaleReplica(authority.lowestActiveSchemaVersion),
      );
    });

    const ensureRegistered = Effect.fn("SyncEngine.ensureRegistered")(function* () {
      const reannouncing = yield* Deferred.isDone(registered);
      if (reannouncing && !(yield* Ref.get(heldBack))) return;
      const cursor = yield* withPermit(store.readSyncCursor());
      if (reannouncing || shouldAnnounce(cursor)) yield* announce(cursor.replicaId);
      yield* Deferred.succeed(registered, undefined);
    });

    const reannounce = withPermit(store.readSyncCursor()).pipe(
      Effect.flatMap((cursor) => announce(cursor.replicaId)),
      Effect.ignore,
    );

    const noteReceipt = (receipt: CommandReceipt) =>
      receipt.result._tag === "rejected" && receipt.result.code === "REPLICA_SCHEMA_OUTDATED"
        ? Ref.getAndSet(heldBack, true).pipe(
            Effect.flatMap((known) => (known ? Effect.void : reannounce)),
          )
        : Effect.void;

    const uploadOnce = Effect.fn("SyncEngine.uploadOnce")(function* () {
      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          const claimedAt = yield* Clock.currentTimeMillis;
          const claimId = yield* makeClaimId;
          const firstAt = yield* Ref.modify(firstClaimAt, (at) => {
            const first = at ?? claimedAt;
            return [first, first] as const;
          });
          const claimed = yield* withPermit(
            store.claimNextUpload({
              claimId,
              claimedAt,
              staleBefore: Math.max(firstAt - 1, claimedAt - STALE_CLAIM_MILLIS),
            }),
          );
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
                yield* noteReceipt(existing);
                return existing;
              }
            }
            const submitted = yield* transport.submitCommand(
              yield* submitRequestFor(activeClaim.envelope),
            );
            const receipt = yield* settleSubmitted(activeClaim.claimId, submitted);
            yield* noteReceipt(receipt);
            return receipt;
          }),
        (activeClaim) =>
          activeClaim
            ? withPermit(store.releaseUploadClaim(activeClaim.operationId, activeClaim.claimId))
            : Effect.void,
      );
    });

    const digestDue = Effect.fn("SyncEngine.digestDue")(function* (
      subscription: SyncSubscription,
      now: number,
    ) {
      if (digestIntervalMillis === "never") return false;
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
        return yield* new ReplicaCoverageRepairRequired({ subscription: pulled.subscription });
      }
      const cursor: SyncCursor = {
        epoch: pulled.epoch,
        applied: OrgCommitSequence.make(applied.appliedThrough),
        horizon: pulled.horizon,
      };
      yield* setCursor(cursor);
      const following = restingPhase(cursor) === "following";
      yield* Ref.set(believesCaughtUp, following);
      if (pulled.digest !== undefined && applied.digestVerified !== false) {
        yield* withPermit(store.recordDigestVerification(pulled.subscription, pulledAt));
      }
      if (following) {
        const caughtUpAt = yield* Clock.currentTimeMillis;
        const lastCaughtUpAt = yield* Ref.get(caughtUpRecordedAt);
        if (dueSince(lastCaughtUpAt, caughtUpAt, CAUGHT_UP_RECORD_INTERVAL_MILLIS)) {
          yield* withPermit(store.recordCaughtUp(caughtUpAt));
          yield* Ref.set(caughtUpRecordedAt, caughtUpAt);
        }
      }
      return following;
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
      const committed = yield* withPermit(
        store.integrateAuthority({
          payload: { _tag: "submitPage", page },
          receipt: { claimId, receipt },
        }),
      );
      const integrated = yield* admitted(committed.value);
      if (integrated.outcome._tag === "pull") return receipt;
      const following = yield* recordAppliedPage(page, integrated, pulledAt);
      if (following) yield* Ref.set(uploadReachedHorizon, page.horizon);
      return receipt;
    });

    const pullPage = Effect.fn("SyncEngine.pullPage")(function* (request: SyncPullRequest) {
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
            yield* recoverSnapshot({
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
      return { pulled, pulledAt };
    });

    const applyPage = Effect.fn("SyncEngine.applyPage")(function* (
      pulled: SyncPullResult,
      pulledAt: number,
    ) {
      const committed = yield* withPermit(
        store.integrateAuthority({ payload: { _tag: "pullPage", page: pulled } }),
      );
      const integrated = yield* admitted(committed.value);
      if (integrated.outcome._tag === "pull") {
        return yield* new SyncTransportGarbled({
          message: `The pulled page did not continue from the replica position ${integrated.appliedThrough}.`,
        });
      }
      yield* recordAppliedPage(pulled, integrated, pulledAt);
      return integrated.appliedThrough;
    });

    const downloadOnce = Effect.fn("SyncEngine.downloadOnce")(function* (request: SyncPullRequest) {
      const { pulled, pulledAt } = yield* pullPage(request);
      return yield* applyPage(pulled, pulledAt);
    });

    const followingPage = (request: SyncPullRequest, pulled: SyncPullResult) =>
      pulled.transactions.length > 0 &&
      compareDecimalSequence(pulled.nextCommitSequence, pulled.horizon) < 0
        ? { ...request, afterCommitSequence: OrgCommitSequence.make(pulled.nextCommitSequence) }
        : undefined;

    const prefetch = Effect.fn("SyncEngine.prefetch")(function* (request: SyncPullRequest) {
      const pulledAt = yield* Clock.currentTimeMillis;
      const pulled = yield* transport.pull(withMaxBytes(request, yield* Ref.get(pullMaxBytes)));
      return { pulled, pulledAt };
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

    const bootstrapFromSnapshot = Effect.fn("SyncEngine.bootstrapFromSnapshot")(function* () {
      const cursor = yield* withPermit(cursorFromStore(store));
      if (cursor.bootstrapped || cursor.appliedCommitSequence !== "0") return;
      yield* recoverSnapshot({
        epoch: cursor.epoch,
        subscription: OPERATIONAL_SUBSCRIPTION,
        replicaId: cursor.replicaId,
      });
      yield* Ref.set(believesCaughtUp, false);
    });

    const recover = Effect.fn("SyncEngine.recover")(function* (code: RecoverableCode) {
      switch (code) {
        case "SNAPSHOT_REQUIRED": {
          const cursor = yield* withPermit(cursorFromStore(store));
          return yield* recoverSnapshot({
            epoch: cursor.epoch,
            subscription: OPERATIONAL_SUBSCRIPTION,
            replicaId: cursor.replicaId,
          });
        }
        case "EPOCH_MISMATCH":
        case "INCARNATION_MISMATCH":
          return yield* new SyncRecoveryRequired({
            code,
            message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
          });
      }
    });

    const catchUp = Effect.fn("SyncEngine.catchUp")(function* () {
      if (yield* uploadLeftReplicaCaughtUp()) return "advanced";
      return yield* Effect.gen(function* () {
        yield* bootstrapFromSnapshot();
        let outcome: SyncCatchUpOutcome = "unchanged";
        let ahead:
          | { readonly from: string; readonly fiber: Fiber.Fiber<PulledPage, SyncEngineError> }
          | undefined;
        while (true) {
          const request = yield* withPermit(pullRequestFromStore(store));
          const page =
            ahead !== undefined && ahead.from === request.afterCommitSequence
              ? yield* Fiber.join(ahead.fiber).pipe(Effect.catch(() => pullPage(request)))
              : yield* (ahead === undefined ? Effect.void : Fiber.interrupt(ahead.fiber)).pipe(
                  Effect.andThen(pullPage(request)),
                );
          const next = followingPage(request, page.pulled);
          ahead =
            next === undefined
              ? undefined
              : {
                  from: next.afterCommitSequence,
                  fiber: yield* Effect.forkScoped(prefetch(next)),
                };
          const appliedThrough = yield* applyPage(page.pulled, page.pulledAt);
          const moved = compareDecimalSequence(appliedThrough, request.afterCommitSequence) > 0;
          if (moved) outcome = "advanced";
          if (!moved || isFollowing(yield* SubscriptionRef.get(state))) return outcome;
        }
      }).pipe(Effect.scoped);
    });

    const hintApplied = Effect.fn("SyncEngine.hintApplied")(function* (hint: SyncLiveWakeHint) {
      const cursor = yield* withPermit(store.readSyncCursor());
      return (
        cursor.epoch === hint.epoch &&
        compareDecimalSequence(hint.horizon, cursor.appliedCommitSequence) <= 0
      );
    });

    const applyTransactionsFrame = Effect.fn("SyncEngine.applyTransactionsFrame")(function* (
      frame: TransactionsFrame,
    ) {
      const committed = yield* withPermit(
        store.integrateAuthority({ payload: { _tag: "liveFrame", frame } }),
      );
      const integrated = yield* admitted(committed.value);
      if (integrated.outcome._tag === "applied") {
        const applied = OrgCommitSequence.make(integrated.appliedThrough);
        yield* SubscriptionRef.update(state, (current) =>
          withCursor(current, { ...current.cursor, epoch: frame.epoch, applied }),
        );
      }
      const outcome: LiveFrameOutcome = integrated.outcome;
      return outcome;
    });

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
          if (!isFollowing(yield* SubscriptionRef.get(state))) {
            return livePull(frame.epoch, frame.toCommitSequence);
          }
          return yield* applyTransactionsFrame(frame);
        }
      }
    });

    return {
      state,
      ensureRegistered,
      awaitRegistered: Deferred.await(registered),
      saveCommand,
      uploadOnce,
      drainUploads,
      downloadOnce,
      catchUp,
      recover,
      hintApplied,
      applyLiveFrame: applyLiveFrameEffect,
      setPullMaxBytes: (maxBytes) => Ref.set(pullMaxBytes, maxBytes),
      pullMaxBytes: Ref.get(pullMaxBytes),
    };
  });

const makeSyncEngineFromContext = (options?: SyncEngineOptions) =>
  Effect.gen(function* () {
    const store = yield* ReplicaStore;
    const transport = yield* SyncTransportService;
    return yield* makeSyncEngineFromReplicaStore(store, transport, options);
  });

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineContract>()(
  "@store/sync/SyncEngine",
) {
  static readonly make = makeSyncEngineFromContext;

  static readonly layer = (options?: SyncEngineOptions) =>
    Layer.effect(SyncEngine, makeSyncEngineFromContext(options));
}
