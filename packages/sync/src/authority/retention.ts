import {
  compareDecimalSequence,
  OrgCommitSequence,
  padDecimalSequence,
  unpadDecimalSequence,
} from "@store/contracts";
import {
  commandReceipts,
  downloadLeases,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  replicas,
  snapshotJobs,
} from "@store/db/inventory.schema";
import { and, asc, eq, lt } from "drizzle-orm";

import { runWrite, type SqliteConnection } from "../sqlite";

export const RETENTION_DELETE_BATCH = 100;

const ACTIVE_SNAPSHOT_STAGES = ["copying", "repairing", "frozen", "exporting"] as const;

export type RetentionProgress = {
  readonly floor: OrgCommitSequence;
  readonly deletedTransactions: number;
  readonly compactedReceipts: number;
};

const pickSequence = (values: ReadonlyArray<string>, prefer: "min" | "max"): string | undefined => {
  const first = values[0];
  if (first === undefined) return undefined;
  let chosen = first;
  for (const value of values) {
    const compared = compareDecimalSequence(
      unpadDecimalSequence(value),
      unpadDecimalSequence(chosen),
    );
    if (prefer === "min" ? compared < 0 : compared > 0) chosen = value;
  }
  return chosen;
};

const publishedHorizons = (tx: SqliteConnection, organizationId: string): ReadonlyArray<string> => {
  const jobs = tx
    .select()
    .from(snapshotJobs)
    .where(
      and(eq(snapshotJobs.organizationId, organizationId), eq(snapshotJobs.stage, "published")),
    )
    .all();
  const horizons: string[] = [];
  for (const job of jobs) {
    if (job.horizon !== null) horizons.push(job.horizon);
  }
  return horizons;
};

const activePins = (tx: SqliteConnection, organizationId: string): ReadonlyArray<string> => {
  const jobs = tx
    .select()
    .from(snapshotJobs)
    .where(eq(snapshotJobs.organizationId, organizationId))
    .all();
  const pins: string[] = [];
  for (const job of jobs) {
    let active = false;
    for (const stage of ACTIVE_SNAPSHOT_STAGES) {
      if (job.stage === stage) active = true;
    }
    if (active) pins.push(job.startedAtCommitSequence);
  }
  return pins;
};

const leasePins = (
  tx: SqliteConnection,
  organizationId: string,
  now: number,
): ReadonlyArray<string> => {
  const leases = tx
    .select()
    .from(downloadLeases)
    .where(eq(downloadLeases.organizationId, organizationId))
    .all();
  const pins: string[] = [];
  for (const lease of leases) {
    if (lease.expiresAt > now) pins.push(lease.pinnedHorizon);
  }
  return pins;
};

const compactReceipts = (tx: SqliteConnection, organizationId: string, budget: number): number => {
  const replicaRows = tx
    .select()
    .from(replicas)
    .where(eq(replicas.organizationId, organizationId))
    .all();
  let deleted = 0;
  for (const replica of replicaRows) {
    if (deleted >= budget) break;
    const watermark = replica.processedThroughClientSequence;
    const rows = tx
      .select()
      .from(commandReceipts)
      .where(
        and(
          eq(commandReceipts.organizationId, organizationId),
          eq(commandReceipts.replicaId, replica.replicaId),
        ),
      )
      .orderBy(asc(commandReceipts.clientSequence))
      .all();
    for (const row of rows) {
      if (deleted >= budget) break;
      if (compareDecimalSequence(row.clientSequence, watermark) > 0) continue;
      runWrite(
        tx
          .delete(commandReceipts)
          .where(
            and(
              eq(commandReceipts.organizationId, organizationId),
              eq(commandReceipts.operationId, row.operationId),
            ),
          ),
      );
      deleted += 1;
    }
  }
  return deleted;
};

const deleteRetiredLog = (
  tx: SqliteConnection,
  organizationId: string,
  floor: string,
  budget: number,
): number => {
  const headers = tx
    .select()
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, organizationId),
        lt(inventoryTransactions.commitSequence, floor),
      ),
    )
    .orderBy(asc(inventoryTransactions.commitSequence))
    .limit(budget)
    .all();
  for (const header of headers) {
    runWrite(
      tx
        .delete(inventoryChanges)
        .where(
          and(
            eq(inventoryChanges.organizationId, organizationId),
            eq(inventoryChanges.commitSequence, header.commitSequence),
          ),
        ),
    );
    runWrite(
      tx
        .delete(inventoryTransactions)
        .where(
          and(
            eq(inventoryTransactions.organizationId, organizationId),
            eq(inventoryTransactions.commitSequence, header.commitSequence),
          ),
        ),
    );
  }
  return headers.length;
};

export const stepRetention = (
  tx: SqliteConnection,
  organizationId: string,
  now: number,
): RetentionProgress => {
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .get();
  if (!state) {
    return {
      floor: OrgCommitSequence.make("0"),
      deletedTransactions: 0,
      compactedReceipts: 0,
    };
  }
  const published = pickSequence(publishedHorizons(tx, organizationId), "max");
  const ceiling = published ?? state.retentionFloor;
  const pins = [...activePins(tx, organizationId), ...leasePins(tx, organizationId, now), ceiling];
  const target = pickSequence(pins, "min") ?? state.retentionFloor;
  const current = unpadDecimalSequence(state.retentionFloor);
  const next =
    compareDecimalSequence(unpadDecimalSequence(target), current) > 0
      ? target
      : state.retentionFloor;
  if (compareDecimalSequence(unpadDecimalSequence(next), current) > 0) {
    runWrite(
      tx
        .update(inventoryState)
        .set({ retentionFloor: padDecimalSequence(unpadDecimalSequence(next)) })
        .where(eq(inventoryState.organizationId, organizationId)),
    );
  }
  const floor = padDecimalSequence(unpadDecimalSequence(next));
  const deletedTransactions = deleteRetiredLog(tx, organizationId, floor, RETENTION_DELETE_BATCH);
  const compactedReceipts = compactReceipts(tx, organizationId, RETENTION_DELETE_BATCH);
  return {
    floor: OrgCommitSequence.make(unpadDecimalSequence(floor)),
    deletedTransactions,
    compactedReceipts,
  };
};

export const grantDownloadLease = (
  tx: SqliteConnection,
  organizationId: string,
  replicaId: string,
  snapshotId: string,
  pinnedHorizon: string,
  expiresAt: number,
): void => {
  runWrite(
    tx
      .insert(downloadLeases)
      .values({
        organizationId,
        replicaId,
        snapshotId,
        pinnedHorizon: padDecimalSequence(pinnedHorizon),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [downloadLeases.organizationId, downloadLeases.replicaId],
        set: {
          snapshotId,
          pinnedHorizon: padDecimalSequence(pinnedHorizon),
          expiresAt,
        },
      }),
  );
};
