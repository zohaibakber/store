import {
  AuthorityIncarnation,
  OrgCommitSequence,
  PartitionDigest,
  SyncEpoch,
  type SyncPullResult,
} from "@store/contracts";
import { replicaCoverage } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { loadCoverage, updateCoverageFromPull } from "../src/replica/coverage";
import { runReplicaTransaction } from "../src/replica/storage";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const downloadedCoverage = {
  _tag: "downloaded" as const,
  subscription: "operational" as const,
  throughCommitSequence: OrgCommitSequence.make("4"),
  digest: PartitionDigest.make("a".repeat(64)),
};

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
  it("marks a partition for repair when the digest mismatches", () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      const first = updateCoverageFromPull(tx, pullWithDigest("a".repeat(64)), "4");
      expect(first.repairRequired).toBe(false);
      expect(loadCoverage(tx, "operational")).toEqual(downloadedCoverage);
      const second = updateCoverageFromPull(tx, pullWithDigest("b".repeat(64)), "4");
      expect(second.repairRequired).toBe(true);
      const row = tx
        .select()
        .from(replicaCoverage)
        .where(eq(replicaCoverage.subscription, "operational"))
        .get();
      expect(row?.state).toBe("awaiting_snapshot");
      expect(loadCoverage(tx, "operational")).toEqual({
        _tag: "awaitingSnapshot",
        subscription: "operational",
      });
    });
    store.close();
  });
});
