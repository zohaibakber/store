import { OrgCommitSequence } from "@store/contracts";
import {
  consumedTickets,
  downloadLeases,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  snapshotJobs,
  snapshotParts,
  snapshotStagedRows,
} from "@store/db/postgres/schema";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  max,
  min,
  notInArray,
  or,
} from "drizzle-orm";
import * as EffectBigInt from "effect/BigInt";
import * as Effect from "effect/Effect";

import type { InventoryError } from "./errors";
import {
  integerTextFromNumeric,
  lockOrganization,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

export type RetentionPolicy = {
  readonly minimumRetainedTransactions: number;
  readonly deleteBatchTransactions: number;
  readonly deleteBatchesPerStep: number;
  readonly expiredLeaseBatchRows: number;
  readonly expiredTicketBatchRows: number;
  readonly abandonedSnapshotJobMillis: number;
  readonly abandonedSnapshotJobBatchRows: number;
  readonly retainedPublishedSnapshots: number;
  readonly prunedSnapshotsPerStep: number;
  readonly snapshotRowDeleteBatchRows: number;
};

const RETENTION_POLICY: RetentionPolicy = {
  minimumRetainedTransactions: 10_000,
  deleteBatchTransactions: 500,
  deleteBatchesPerStep: 4,
  expiredLeaseBatchRows: 200,
  expiredTicketBatchRows: 500,
  abandonedSnapshotJobMillis: 60 * 60_000,
  abandonedSnapshotJobBatchRows: 20,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
};

const TERMINAL_SNAPSHOT_STAGES = ["published", "failed"] as const;

export type RetentionProgress = {
  readonly organizationId: string;
  readonly floorBefore: OrgCommitSequence;
  readonly floorAfter: OrgCommitSequence;
  readonly deletedTransactions: number;
  readonly expiredTickets: number;
  readonly prunedSnapshots: number;
  readonly more: boolean;
};

const sequenceOf = (value: string | null, fallback: bigint) =>
  value === null ? fallback : BigInt(integerTextFromNumeric(value));

const publishFloor = Effect.fn("InventoryRetention.publishFloor")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  now: number,
  policy: RetentionPolicy,
) {
  const state = yield* lockOrganization(tx, organizationId);
  const floorBefore = BigInt(integerTextFromNumeric(state.retentionFloor));
  const head = BigInt(integerTextFromNumeric(state.commitSequence));

  const [published] = yield* tx
    .select({ horizon: max(snapshotJobs.horizon) })
    .from(snapshotJobs)
    .where(
      and(eq(snapshotJobs.organizationId, organizationId), eq(snapshotJobs.stage, "published")),
    );
  const [lease] = yield* tx
    .select({ pinnedHorizon: min(downloadLeases.pinnedHorizon) })
    .from(downloadLeases)
    .where(
      and(eq(downloadLeases.organizationId, organizationId), gt(downloadLeases.expiresAt, now)),
    );

  const snapshotHorizon = sequenceOf(published?.horizon ?? null, 0n);
  const leaseHorizon = sequenceOf(lease?.pinnedHorizon ?? null, head);
  const headFloor = EffectBigInt.max(0n, head - BigInt(policy.minimumRetainedTransactions));
  const candidate = EffectBigInt.min(snapshotHorizon, EffectBigInt.min(leaseHorizon, headFloor));
  const floorAfter = EffectBigInt.max(candidate, floorBefore);

  if (floorAfter !== floorBefore) {
    yield* tx
      .update(inventoryState)
      .set({ retentionFloor: String(floorAfter) })
      .where(eq(inventoryState.organizationId, organizationId));
  }
  return { floorBefore: String(floorBefore), floorAfter: String(floorAfter) };
});

const deleteHistoryBatch = Effect.fn("InventoryRetention.deleteHistoryBatch")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  floor: string,
  policy: RetentionPolicy,
) {
  const groups = yield* tx
    .select({ commitSequence: inventoryTransactions.commitSequence })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, organizationId),
        lte(inventoryTransactions.commitSequence, floor),
      ),
    )
    .orderBy(asc(inventoryTransactions.commitSequence))
    .limit(policy.deleteBatchTransactions);
  if (groups.length === 0) return 0;
  const sequences = groups.map((group) => group.commitSequence);
  yield* tx
    .delete(inventoryChanges)
    .where(
      and(
        eq(inventoryChanges.organizationId, organizationId),
        inArray(inventoryChanges.commitSequence, sequences),
      ),
    );
  yield* tx
    .delete(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, organizationId),
        inArray(inventoryTransactions.commitSequence, sequences),
      ),
    );
  return groups.length;
});

const historyRemains = Effect.fn("InventoryRetention.historyRemains")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  floor: string,
) {
  const rows = yield* tx
    .select({ commitSequence: inventoryTransactions.commitSequence })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, organizationId),
        lte(inventoryTransactions.commitSequence, floor),
      ),
    )
    .limit(1);
  return rows.length > 0;
});

const expireDownloadLeases = Effect.fn("InventoryRetention.expireDownloadLeases")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  now: number,
  policy: RetentionPolicy,
) {
  const stale = yield* tx
    .select({ replicaId: downloadLeases.replicaId })
    .from(downloadLeases)
    .where(
      and(eq(downloadLeases.organizationId, organizationId), lte(downloadLeases.expiresAt, now)),
    )
    .orderBy(asc(downloadLeases.replicaId))
    .limit(policy.expiredLeaseBatchRows);
  if (stale.length === 0) return 0;
  yield* tx.delete(downloadLeases).where(
    and(
      eq(downloadLeases.organizationId, organizationId),
      inArray(
        downloadLeases.replicaId,
        stale.map((row) => row.replicaId),
      ),
    ),
  );
  return stale.length;
});

const expireConsumedTickets = Effect.fn("InventoryRetention.expireConsumedTickets")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  now: number,
  policy: RetentionPolicy,
) {
  const expired = yield* tx
    .select({ nonceHash: consumedTickets.nonceHash })
    .from(consumedTickets)
    .where(
      and(eq(consumedTickets.organizationId, organizationId), lte(consumedTickets.expiresAt, now)),
    )
    .orderBy(asc(consumedTickets.expiresAt), asc(consumedTickets.nonceHash))
    .limit(policy.expiredTicketBatchRows);
  if (expired.length === 0) return 0;
  yield* tx.delete(consumedTickets).where(
    and(
      eq(consumedTickets.organizationId, organizationId),
      inArray(
        consumedTickets.nonceHash,
        expired.map((row) => row.nonceHash),
      ),
    ),
  );
  return expired.length;
});

const failAbandonedSnapshotJobs = Effect.fn("InventoryRetention.failAbandonedSnapshotJobs")(
  function* (
    tx: InventoryTransaction,
    organizationId: string,
    now: number,
    policy: RetentionPolicy,
  ) {
    const abandonedBefore = now - policy.abandonedSnapshotJobMillis;
    const abandoned = yield* tx
      .select({ snapshotId: snapshotJobs.snapshotId })
      .from(snapshotJobs)
      .where(
        and(
          eq(snapshotJobs.organizationId, organizationId),
          notInArray(snapshotJobs.stage, [...TERMINAL_SNAPSHOT_STAGES]),
          isNotNull(snapshotJobs.ownerToken),
          lte(snapshotJobs.stepDueAt, abandonedBefore),
        ),
      )
      .orderBy(asc(snapshotJobs.snapshotId))
      .limit(policy.abandonedSnapshotJobBatchRows);
    if (abandoned.length === 0) return 0;
    yield* tx
      .update(snapshotJobs)
      .set({ stage: "failed", ownerToken: null, stepDueAt: now })
      .where(
        and(
          eq(snapshotJobs.organizationId, organizationId),
          isNotNull(snapshotJobs.ownerToken),
          lte(snapshotJobs.stepDueAt, abandonedBefore),
          inArray(
            snapshotJobs.snapshotId,
            abandoned.map((row) => row.snapshotId),
          ),
        ),
      );
    return abandoned.length;
  },
);

const pruneSupersededSnapshots = Effect.fn("InventoryRetention.pruneSupersededSnapshots")(
  function* (tx: InventoryTransaction, organizationId: string, policy: RetentionPolicy) {
    const published = yield* tx
      .select({ snapshotId: snapshotJobs.snapshotId })
      .from(snapshotJobs)
      .where(
        and(eq(snapshotJobs.organizationId, organizationId), eq(snapshotJobs.stage, "published")),
      )
      .orderBy(desc(snapshotJobs.horizon), asc(snapshotJobs.snapshotId))
      .limit(policy.retainedPublishedSnapshots + policy.prunedSnapshotsPerStep);
    const superseded = published.slice(policy.retainedPublishedSnapshots);
    if (superseded.length === 0) return 0;

    const leases = yield* tx
      .select({ snapshotId: downloadLeases.snapshotId })
      .from(downloadLeases)
      .where(eq(downloadLeases.organizationId, organizationId));
    const pinned = new Set(leases.map((lease) => lease.snapshotId));

    let budget = policy.snapshotRowDeleteBatchRows;
    let pruned = 0;
    for (const candidate of superseded) {
      if (budget <= 0) break;
      if (pinned.has(candidate.snapshotId)) continue;

      const partBudget = budget;
      const parts = yield* tx
        .select({ partNumber: snapshotParts.partNumber })
        .from(snapshotParts)
        .where(
          and(
            eq(snapshotParts.organizationId, organizationId),
            eq(snapshotParts.snapshotId, candidate.snapshotId),
          ),
        )
        .orderBy(asc(snapshotParts.partNumber))
        .limit(partBudget);
      if (parts.length > 0) {
        yield* tx.delete(snapshotParts).where(
          and(
            eq(snapshotParts.organizationId, organizationId),
            eq(snapshotParts.snapshotId, candidate.snapshotId),
            inArray(
              snapshotParts.partNumber,
              parts.map((part) => part.partNumber),
            ),
          ),
        );
        budget -= parts.length;
      }
      if (parts.length === partBudget) continue;

      const stagedBudget = budget;
      const staged = yield* tx
        .select({ entity: snapshotStagedRows.entity, entityId: snapshotStagedRows.entityId })
        .from(snapshotStagedRows)
        .where(
          and(
            eq(snapshotStagedRows.organizationId, organizationId),
            eq(snapshotStagedRows.snapshotId, candidate.snapshotId),
          ),
        )
        .orderBy(asc(snapshotStagedRows.entity), asc(snapshotStagedRows.entityId))
        .limit(stagedBudget);
      if (staged.length > 0) {
        yield* tx
          .delete(snapshotStagedRows)
          .where(
            and(
              eq(snapshotStagedRows.organizationId, organizationId),
              eq(snapshotStagedRows.snapshotId, candidate.snapshotId),
              or(
                ...staged.map((row) =>
                  and(
                    eq(snapshotStagedRows.entity, row.entity),
                    eq(snapshotStagedRows.entityId, row.entityId),
                  ),
                ),
              ),
            ),
          );
        budget -= staged.length;
      }
      if (staged.length === stagedBudget) continue;

      yield* tx
        .delete(snapshotJobs)
        .where(
          and(
            eq(snapshotJobs.organizationId, organizationId),
            eq(snapshotJobs.snapshotId, candidate.snapshotId),
          ),
        );
      pruned += 1;
    }
    return pruned;
  },
);

export const runRetentionStep =
  (db: InventoryDrizzle, policy: RetentionPolicy = RETENTION_POLICY) =>
  (organizationId: string, now: number): Effect.Effect<RetentionProgress, InventoryError> => {
    const transact = runTransaction(db);
    return Effect.gen(function* () {
      const floors = yield* transact("read committed", "read write", (tx) =>
        Effect.gen(function* () {
          const published = yield* publishFloor(tx, organizationId, now, policy);
          yield* expireDownloadLeases(tx, organizationId, now, policy);
          const expiredTickets = yield* expireConsumedTickets(tx, organizationId, now, policy);
          yield* failAbandonedSnapshotJobs(tx, organizationId, now, policy);
          return { ...published, expiredTickets };
        }),
      );

      let deletedTransactions = 0;
      let batches = 0;
      let exhausted = false;
      while (batches < policy.deleteBatchesPerStep) {
        const deleted = yield* transact("read committed", "read write", (tx) =>
          deleteHistoryBatch(tx, organizationId, floors.floorAfter, policy),
        );
        batches += 1;
        deletedTransactions += deleted;
        if (deleted < policy.deleteBatchTransactions) {
          exhausted = true;
          break;
        }
      }
      const prunedSnapshots = yield* transact("read committed", "read write", (tx) =>
        pruneSupersededSnapshots(tx, organizationId, policy),
      );

      const more = exhausted
        ? false
        : yield* transact("repeatable read", "read only", (tx) =>
            historyRemains(tx, organizationId, floors.floorAfter),
          );

      return {
        organizationId,
        floorBefore: OrgCommitSequence.make(floors.floorBefore),
        floorAfter: OrgCommitSequence.make(floors.floorAfter),
        deletedTransactions,
        expiredTickets: floors.expiredTickets,
        prunedSnapshots,
        more,
      } satisfies RetentionProgress;
    });
  };
