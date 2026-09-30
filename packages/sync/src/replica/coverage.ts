import {
  OrgCommitSequence,
  type PartitionDigestReport,
  type SyncCoverage,
  type SyncPullResult,
  type SyncSubscription,
} from "@store/contracts";
import { replicaCoverage } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";

import { loadReplicaState } from "./commands";
import { decideCoverageAfterPull } from "./decisions";
import { logPartitionDivergence, readPartitionDigest, type DigestReader } from "./digest";
import type { ReplicaStoreError } from "./errors";
import type { ReplicaDb } from "./sql-client/drizzle";

type DigestVerification = {
  readonly verifiedAt: number | undefined;
};

const saveCoverage = Effect.fn("ReplicaCoverage.saveCoverage")(function* (
  tx: ReplicaDb,
  coverage: SyncCoverage,
) {
  if (coverage._tag === "awaitingSnapshot") {
    yield* tx
      .insert(replicaCoverage)
      .values({
        subscription: coverage.subscription,
        state: "awaiting_snapshot",
        throughCommitSequence: null,
        digest: null,
        verifiedAt: null,
      })
      .onConflictDoUpdate({
        target: replicaCoverage.subscription,
        set: {
          state: "awaiting_snapshot",
          throughCommitSequence: null,
          digest: null,
          verifiedAt: null,
        },
      });
    return;
  }
  yield* tx
    .insert(replicaCoverage)
    .values({
      subscription: coverage.subscription,
      state: "downloaded",
      throughCommitSequence: coverage.throughCommitSequence,
      digest: coverage.digest,
    })
    .onConflictDoUpdate({
      target: replicaCoverage.subscription,
      set: {
        state: "downloaded",
        throughCommitSequence: coverage.throughCommitSequence,
        digest: coverage.digest,
      },
    });
});

export const loadDigestVerification = Effect.fn("ReplicaCoverage.loadDigestVerification")(
  function* (tx: ReplicaDb, subscription: SyncSubscription) {
    const row = yield* tx
      .select()
      .from(replicaCoverage)
      .where(eq(replicaCoverage.subscription, subscription))
      .get();
    return { verifiedAt: row?.verifiedAt ?? undefined } satisfies DigestVerification;
  },
);

export const recordDigestVerification = Effect.fn("ReplicaCoverage.recordDigestVerification")(
  function* (tx: ReplicaDb, subscription: SyncSubscription, verifiedAt: number) {
    yield* tx
      .insert(replicaCoverage)
      .values({
        subscription,
        state: "downloaded",
        throughCommitSequence: null,
        digest: null,
        verifiedAt,
      })
      .onConflictDoUpdate({
        target: replicaCoverage.subscription,
        set: { verifiedAt },
      });
  },
);

export const recordSnapshotCoverage = Effect.fn("ReplicaCoverage.recordSnapshotCoverage")(
  function* (tx: ReplicaDb, subscription: SyncSubscription, throughCommitSequence: string) {
    const fields = {
      state: "downloaded",
      throughCommitSequence,
      digest: null,
      verifiedAt: null,
    } as const;
    yield* tx
      .insert(replicaCoverage)
      .values({ subscription, ...fields })
      .onConflictDoUpdate({ target: replicaCoverage.subscription, set: fields });
  },
);

export const markCoverageRepair = (tx: ReplicaDb, subscription: SyncSubscription) =>
  saveCoverage(tx, { _tag: "awaitingSnapshot", subscription });

export type DigestFence = {
  readonly appliedCommitSequence: string;
  readonly localCommitVersion: number;
  readonly activeGeneration: number;
};

export type ReplicaTransactor = <A, E>(
  span: string,
  run: (tx: ReplicaDb) => Effect.Effect<A, E>,
) => Effect.Effect<A, ReplicaStoreError>;

type PulledCoverage = {
  readonly repairRequired: boolean;
  readonly digestVerified: boolean;
};

type ScannedDigest = {
  readonly fence: DigestFence;
  readonly report: PartitionDigestReport | undefined;
};

class DigestFenceMoved extends Data.TaggedError("DigestFenceMoved")<{
  readonly current: DigestFence;
}> {}

const DIGEST_SCAN_ATTEMPTS = 3;

const UNVERIFIED: PulledCoverage = { repairRequired: false, digestVerified: false };

export const readDigestFence = Effect.fn("ReplicaCoverage.readDigestFence")(function* (
  tx: ReplicaDb,
) {
  const state = yield* loadReplicaState(tx);
  return {
    appliedCommitSequence: state.appliedCommitSequence,
    localCommitVersion: state.localCommitVersion,
    activeGeneration: state.activeGeneration,
  } satisfies DigestFence;
});

const sameAuthorityState = (left: DigestFence, right: DigestFence): boolean =>
  left.appliedCommitSequence === right.appliedCommitSequence &&
  left.activeGeneration === right.activeGeneration;

const sameFence = (left: DigestFence, right: DigestFence): boolean =>
  sameAuthorityState(left, right) && left.localCommitVersion === right.localCommitVersion;

const fencedReader =
  (
    transact: ReplicaTransactor,
    fence: DigestFence,
  ): DigestReader<DigestFenceMoved | ReplicaStoreError> =>
  <A>(read: (tx: ReplicaDb) => Effect.Effect<A, EffectDrizzleQueryError>) =>
    transact("SqliteReplicaStore.readDigestChunk", (tx) =>
      readDigestFence(tx).pipe(
        Effect.flatMap(
          (current): Effect.Effect<Result.Result<A, DigestFenceMoved>, EffectDrizzleQueryError> =>
            sameFence(current, fence)
              ? read(tx).pipe(Effect.map(Result.succeed))
              : Effect.succeed(Result.fail(new DigestFenceMoved({ current }))),
        ),
      ),
    ).pipe(Effect.flatMap(Effect.fromResult));

const scanUnderFence = Effect.fn("ReplicaCoverage.scanUnderFence")(function* (
  transact: ReplicaTransactor,
  fence: DigestFence,
) {
  const latest = yield* Ref.make(fence);
  return yield* Ref.get(latest).pipe(
    Effect.flatMap((current) =>
      readPartitionDigest(fencedReader(transact, current)).pipe(
        Effect.map((report): ScannedDigest | undefined => ({ fence: current, report })),
      ),
    ),
    Effect.tapError((error) =>
      error._tag === "DigestFenceMoved" ? Ref.set(latest, error.current) : Effect.void,
    ),
    Effect.retry({
      times: DIGEST_SCAN_ATTEMPTS - 1,
      while: (error) =>
        error._tag === "DigestFenceMoved" && sameAuthorityState(error.current, fence),
    }),
    Effect.catchTag("DigestFenceMoved", (moved) =>
      Effect.logInfo("replica partition digest deferred: the replica changed during the scan", {
        scannedThrough: fence.appliedCommitSequence,
        currentThrough: moved.current.appliedCommitSequence,
      }).pipe(Effect.as(undefined)),
    ),
  );
});

const settleScannedDigest = Effect.fn("ReplicaCoverage.settleScannedDigest")(function* (
  tx: ReplicaDb,
  pulled: SyncPullResult,
  scanned: ScannedDigest,
) {
  const current = yield* readDigestFence(tx);
  if (!sameFence(current, scanned.fence)) {
    yield* Effect.logInfo(
      "replica partition digest deferred: the replica changed before recording",
    );
    return UNVERIFIED;
  }
  const next = decideCoverageAfterPull(scanned.report, pulled.digest);
  if (next._tag === "repair") {
    yield* logPartitionDivergence(pulled.subscription, next.diverged);
    yield* markCoverageRepair(tx, pulled.subscription);
    return { repairRequired: true, digestVerified: false } satisfies PulledCoverage;
  }
  if (next._tag === "unchanged") return UNVERIFIED;
  yield* saveCoverage(tx, {
    _tag: "downloaded",
    subscription: pulled.subscription,
    throughCommitSequence: OrgCommitSequence.make(current.appliedCommitSequence),
    digest: next.digest,
  });
  return { repairRequired: false, digestVerified: next.verified } satisfies PulledCoverage;
});

export const verifyPulledDigest = Effect.fn("ReplicaCoverage.verifyPulledDigest")(function* (
  transact: ReplicaTransactor,
  pulled: SyncPullResult,
  fence: DigestFence | undefined,
) {
  if (pulled.digest === undefined || fence === undefined) return UNVERIFIED;
  const scanned = yield* scanUnderFence(transact, fence);
  if (scanned === undefined) return UNVERIFIED;
  return yield* transact("SqliteReplicaStore.settleDigestCoverage", (tx) =>
    settleScannedDigest(tx, pulled, scanned),
  );
});
