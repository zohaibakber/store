import {
  OrgCommitSequence,
  PartitionDigest,
  type SyncCoverage,
  type SyncPullResult,
  type SyncSubscription,
} from "@store/contracts";
import { replicaCoverage } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";

import { runWrite } from "../sqlite";
import type { ReplicaDb } from "./storage";

export type CoverageUpdate = {
  readonly repairRequired: boolean;
};

const parseSubscription = (subscription: string): SyncSubscription => {
  if (subscription === "operational") return "operational";
  throw new Error("Replica coverage subscription is invalid.");
};

export const loadCoverage = (
  tx: ReplicaDb,
  subscription: SyncSubscription,
): SyncCoverage | undefined => {
  const row = tx
    .select()
    .from(replicaCoverage)
    .where(eq(replicaCoverage.subscription, subscription))
    .get();
  if (!row) return undefined;
  if (row.state === "awaiting_snapshot") {
    return { _tag: "awaitingSnapshot", subscription: parseSubscription(row.subscription) };
  }
  if (row.throughCommitSequence && row.digest) {
    return {
      _tag: "downloaded",
      subscription: parseSubscription(row.subscription),
      throughCommitSequence: OrgCommitSequence.make(row.throughCommitSequence),
      digest: PartitionDigest.make(row.digest),
    };
  }
  return undefined;
};

export const saveCoverage = (tx: ReplicaDb, coverage: SyncCoverage): void => {
  if (coverage._tag === "awaitingSnapshot") {
    runWrite(
      tx
        .insert(replicaCoverage)
        .values({
          subscription: coverage.subscription,
          state: "awaiting_snapshot",
          throughCommitSequence: null,
          digest: null,
        })
        .onConflictDoUpdate({
          target: replicaCoverage.subscription,
          set: {
            state: "awaiting_snapshot",
            throughCommitSequence: null,
            digest: null,
          },
        }),
    );
    return;
  }
  runWrite(
    tx
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
      }),
  );
};

export const markCoverageRepair = (tx: ReplicaDb, subscription: SyncSubscription): void => {
  saveCoverage(tx, { _tag: "awaitingSnapshot", subscription });
};

export const updateCoverageFromPull = (
  tx: ReplicaDb,
  pulled: SyncPullResult,
  appliedThrough: string,
): CoverageUpdate => {
  const existing = loadCoverage(tx, pulled.subscription);
  if (pulled.digest && existing?._tag === "downloaded" && existing.digest !== pulled.digest) {
    markCoverageRepair(tx, pulled.subscription);
    return { repairRequired: true };
  }
  if (pulled.digest) {
    saveCoverage(tx, {
      _tag: "downloaded",
      subscription: pulled.subscription,
      throughCommitSequence: OrgCommitSequence.make(appliedThrough),
      digest: pulled.digest,
    });
  }
  return { repairRequired: false };
};
