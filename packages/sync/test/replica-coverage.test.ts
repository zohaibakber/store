import {
  AuthorityIncarnation,
  OrgCommitSequence,
  PartitionDigest,
  SyncEpoch,
  type SyncPullResult,
} from "@store/contracts";
import { replicaCoverage } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { applyTransactionGroup } from "../src/replica/apply";
import { loadCoverage, updateCoverageFromPull } from "../src/replica/coverage";
import { runReplicaTransaction } from "../src/replica/storage";
import { authorityDigest, commitToAuthority, makeAuthorityPartition } from "./lib/authority-digest";
import { seedCatalogGroup } from "./lib/pending-fixture";
import { withSeededReplica } from "./lib/replica-fixture";

const pullWithDigest = (digest: string): SyncPullResult => ({
  epoch: SyncEpoch.make("1"),
  incarnation: AuthorityIncarnation.make("incarnation-test"),
  subscription: "operational",
  schemaVersion: 1,
  transactions: [],
  nextCommitSequence: OrgCommitSequence.make("5"),
  horizon: OrgCommitSequence.make("10"),
  retentionFloor: OrgCommitSequence.make("0"),
  digest: PartitionDigest.make(digest),
});

describe("replica coverage", () => {
  it("marks a partition for repair when the authority digest disagrees with local rows", async () => {
    const authority = makeAuthorityPartition();
    commitToAuthority(authority, seedCatalogGroup);
    const expected = authorityDigest(authority);
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* applyTransactionGroup(tx, seedCatalogGroup);
            const first = yield* updateCoverageFromPull(tx, pullWithDigest(expected), "4");
            const afterFirst = yield* loadCoverage(tx, "operational");
            const second = yield* updateCoverageFromPull(tx, pullWithDigest("b".repeat(64)), "4");
            const row = yield* tx
              .select()
              .from(replicaCoverage)
              .where(eq(replicaCoverage.subscription, "operational"))
              .get();
            const afterSecond = yield* loadCoverage(tx, "operational");
            return { first, afterFirst, second, state: row?.state, afterSecond };
          }),
        ),
      ),
    );
    expect(seen.first).toEqual({ repairRequired: false, digestVerified: true });
    expect(seen.afterFirst).toEqual({
      _tag: "downloaded",
      subscription: "operational",
      throughCommitSequence: OrgCommitSequence.make("4"),
      digest: expected,
    });
    expect(seen.second.repairRequired).toBe(true);
    expect(seen.state).toBe("awaiting_snapshot");
    expect(seen.afterSecond).toEqual({ _tag: "awaitingSnapshot", subscription: "operational" });
  });

  it("does not repair when a repeated digest matches the unchanged local rows", async () => {
    const authority = makeAuthorityPartition();
    commitToAuthority(authority, seedCatalogGroup);
    const expected = authorityDigest(authority);
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* applyTransactionGroup(tx, seedCatalogGroup);
            const first = yield* updateCoverageFromPull(tx, pullWithDigest(expected), "4");
            const second = yield* updateCoverageFromPull(tx, pullWithDigest(expected), "4");
            return { first, second };
          }),
        ),
      ),
    );
    expect(seen.first.repairRequired).toBe(false);
    expect(seen.second.repairRequired).toBe(false);
  });
});
