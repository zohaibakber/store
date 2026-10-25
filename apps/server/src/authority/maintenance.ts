import {
  authorityChanges,
  authorityState,
  authorityTransactions,
  downloadLeases,
  importParts,
  snapshotParts,
  snapshots,
} from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import { and, asc, count, desc, eq, gt, lte, max, min } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { AuthorityEngine } from "./engine";
import { isFresh, type AuthoritySnapshots, type SnapshotPolicy } from "./snapshots";

export type MaintenancePolicy = SnapshotPolicy & {
  readonly budgetMillis: number;
  readonly minimumRetainedTransactions: number;
  readonly deleteBatchTransactions: number;
  readonly deleteBatchesPerStep: number;
  readonly expiredLeaseBatchRows: number;
  readonly retainedPublishedSnapshots: number;
  readonly prunedSnapshotsPerStep: number;
  readonly snapshotRowDeleteBatchRows: number;
  readonly abandonedImportMillis: number;
  readonly abandonedImportBatchParts: number;
};

export type MaintenanceReport = {
  readonly floorBefore: string;
  readonly floorAfter: string;
  readonly deletedTransactions: number;
  readonly expiredLeases: number;
  readonly prunedSnapshots: number;
  readonly builtSnapshot: boolean;
  readonly sweptImportParts: number;
  readonly more: boolean;
};

export const makeAuthorityMaintenance = (
  engine: AuthorityEngine,
  db: ReplicaDb,
  snapshotsOf: AuthoritySnapshots,
) => {
  const expireLeases = Effect.fn("AuthorityMaintenance.expireLeases")(function* (now: number) {
    const expired = yield* db
      .select({ total: count() })
      .from(downloadLeases)
      .where(lte(downloadLeases.expiresAt, now))
      .get();
    yield* db.delete(downloadLeases).where(lte(downloadLeases.expiresAt, now));
    return expired?.total ?? 0;
  });

  const pruneSnapshots = Effect.fn("AuthorityMaintenance.pruneSnapshots")(function* (
    policy: MaintenancePolicy,
  ) {
    const candidates = yield* db
      .select({ snapshotId: snapshots.snapshotId })
      .from(snapshots)
      .orderBy(desc(snapshots.horizon), asc(snapshots.snapshotId))
      .limit(policy.prunedSnapshotsPerStep)
      .offset(policy.retainedPublishedSnapshots)
      .all();
    let pruned = 0;
    let budget = policy.snapshotRowDeleteBatchRows;
    for (const { snapshotId } of candidates) {
      if (budget <= 0) break;
      const leased = yield* db
        .select({ replicaId: downloadLeases.replicaId })
        .from(downloadLeases)
        .where(eq(downloadLeases.snapshotId, snapshotId))
        .limit(1)
        .get();
      if (leased !== undefined) continue;
      const doomed = yield* db
        .select({ partNumber: snapshotParts.partNumber })
        .from(snapshotParts)
        .where(eq(snapshotParts.snapshotId, snapshotId))
        .orderBy(asc(snapshotParts.partNumber))
        .limit(budget)
        .all();
      const lastDoomed = doomed.at(-1);
      if (lastDoomed !== undefined) {
        yield* db
          .delete(snapshotParts)
          .where(
            and(
              eq(snapshotParts.snapshotId, snapshotId),
              lte(snapshotParts.partNumber, lastDoomed.partNumber),
            ),
          );
      }
      budget -= doomed.length;
      const remaining = yield* db
        .select({ total: count() })
        .from(snapshotParts)
        .where(eq(snapshotParts.snapshotId, snapshotId))
        .get();
      if ((remaining?.total ?? 0) > 0) continue;
      yield* db.delete(snapshots).where(eq(snapshots.snapshotId, snapshotId));
      pruned += 1;
    }
    return pruned;
  });

  const trimHistory = Effect.fn("AuthorityMaintenance.trimHistory")(function* (
    floor: number,
    policy: MaintenancePolicy,
    deadline: number,
  ) {
    let deleted = 0;
    let outOfTime = false;
    for (let batch = 0; batch < policy.deleteBatchesPerStep; batch += 1) {
      const picked = yield* db
        .select({ commitSequence: authorityTransactions.commitSequence })
        .from(authorityTransactions)
        .where(lte(authorityTransactions.commitSequence, floor))
        .orderBy(asc(authorityTransactions.commitSequence))
        .limit(policy.deleteBatchTransactions)
        .all();
      const last = picked.at(-1);
      if (last !== undefined) {
        yield* db
          .delete(authorityChanges)
          .where(lte(authorityChanges.commitSequence, last.commitSequence));
        yield* db
          .delete(authorityTransactions)
          .where(lte(authorityTransactions.commitSequence, last.commitSequence));
      }
      deleted += picked.length;
      if (picked.length < policy.deleteBatchTransactions) break;
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        outOfTime = true;
        break;
      }
    }
    const remains = yield* db
      .select({ commitSequence: authorityTransactions.commitSequence })
      .from(authorityTransactions)
      .where(lte(authorityTransactions.commitSequence, floor))
      .limit(1)
      .get();
    return { deleted, more: outOfTime || remains !== undefined };
  });

  const sweepImports = Effect.fn("AuthorityMaintenance.sweepImports")(function* (
    now: number,
    policy: MaintenancePolicy,
  ) {
    const stale = yield* db
      .select({ importId: importParts.importId, partNumber: importParts.partNumber })
      .from(importParts)
      .where(lte(importParts.receivedAt, now - policy.abandonedImportMillis))
      .orderBy(asc(importParts.receivedAt))
      .limit(policy.abandonedImportBatchParts)
      .all();
    for (const part of stale) {
      yield* db
        .delete(importParts)
        .where(
          and(eq(importParts.importId, part.importId), eq(importParts.partNumber, part.partNumber)),
        );
    }
    return stale.length;
  });

  return {
    run: Effect.fn("AuthorityMaintenance.run")(function* (now: number, policy: MaintenancePolicy) {
      return yield* engine.transact(
        Effect.gen(function* () {
          const deadline = (yield* Clock.currentTimeMillis) + policy.budgetMillis;
          const state = yield* engine.loadState;
          const sweptImportParts = yield* sweepImports(now, policy);
          if (state === undefined) {
            return {
              floorBefore: "0",
              floorAfter: "0",
              deletedTransactions: 0,
              expiredLeases: 0,
              prunedSnapshots: 0,
              builtSnapshot: false,
              sweptImportParts,
              more: sweptImportParts === policy.abandonedImportBatchParts,
            } satisfies MaintenanceReport;
          }
          const expiredLeases = yield* expireLeases(now);
          const newest = yield* snapshotsOf.newest;
          const builtSnapshot = !isFresh(state.commitSequence, newest, now, policy);
          if (builtSnapshot) yield* snapshotsOf.build(state, now, policy);
          const prunedSnapshots = yield* pruneSnapshots(policy);
          const snapshotHorizon =
            (yield* db
              .select({ horizon: max(snapshots.horizon) })
              .from(snapshots)
              .get())?.horizon ?? 0;
          const leaseHorizon =
            (yield* db
              .select({ horizon: min(downloadLeases.pinnedHorizon) })
              .from(downloadLeases)
              .where(gt(downloadLeases.expiresAt, now))
              .get())?.horizon ?? state.commitSequence;
          const floorAfter = Math.max(
            Math.min(
              snapshotHorizon,
              leaseHorizon,
              Math.max(0, state.commitSequence - policy.minimumRetainedTransactions),
            ),
            state.retentionFloor,
          );
          yield* db
            .update(authorityState)
            .set({ retentionFloor: floorAfter, maintainedAt: now })
            .where(eq(authorityState.id, state.id));
          const trimmed = yield* trimHistory(floorAfter, policy, deadline);
          return {
            floorBefore: String(state.retentionFloor),
            floorAfter: String(floorAfter),
            deletedTransactions: trimmed.deleted,
            expiredLeases,
            prunedSnapshots,
            builtSnapshot,
            sweptImportParts,
            more: trimmed.more || sweptImportParts === policy.abandonedImportBatchParts,
          } satisfies MaintenanceReport;
        }),
      );
    }),

    pendingWork: Effect.fn("AuthorityMaintenance.pendingWork")(function* () {
      const lease = yield* db
        .select({ replicaId: downloadLeases.replicaId })
        .from(downloadLeases)
        .limit(1)
        .get();
      const part = yield* db
        .select({ importId: importParts.importId })
        .from(importParts)
        .limit(1)
        .get();
      return lease !== undefined || part !== undefined;
    }),
  };
};
