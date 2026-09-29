import {
  OrgCommitSequence,
  type SyncCoverage,
  type SyncPullResult,
  type SyncSubscription,
} from "@store/contracts";
import { replicaCoverage } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { decideCoverageAfterPull } from "./decisions";
import { logPartitionDivergence, sqlitePartitionDigest } from "./digest";
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

export const markCoverageRepair = (tx: ReplicaDb, subscription: SyncSubscription) =>
  saveCoverage(tx, { _tag: "awaitingSnapshot", subscription });

export const updateCoverageFromPull = Effect.fn("ReplicaCoverage.updateCoverageFromPull")(
  function* (tx: ReplicaDb, pulled: SyncPullResult, appliedThrough: string) {
    const localDigest =
      pulled.digest === undefined
        ? undefined
        : yield* sqlitePartitionDigest(tx, pulled.digest.version);
    const next = decideCoverageAfterPull(localDigest, pulled.digest);
    if (next._tag === "repair") {
      yield* logPartitionDivergence(pulled.subscription, next.diverged);
      yield* markCoverageRepair(tx, pulled.subscription);
    }
    if (next._tag === "record") {
      yield* saveCoverage(tx, {
        _tag: "downloaded",
        subscription: pulled.subscription,
        throughCommitSequence: OrgCommitSequence.make(appliedThrough),
        digest: next.digest,
      });
    }
    return {
      repairRequired: next._tag === "repair",
      digestVerified: next._tag === "record" && next.verified,
    };
  },
);
