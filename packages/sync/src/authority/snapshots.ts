import {
  MAX_SNAPSHOT_PART_ROWS,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SYNC_SCHEMA_VERSION,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartPayload,
  SyncEntity,
  SyncEpoch,
  SyncSubscription,
  canonicalJson,
  unpadDecimalSequence,
  type SnapshotRow,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  snapshotJobs,
  snapshotParts,
  snapshotStagedRows,
} from "@store/db/inventory.schema";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite, type SqliteConnection } from "../sqlite";
import {
  nextPartitionEntity,
  parsePartitionEntity,
  readPartitionPage,
  subscriptionEntities,
  type PartitionEntity,
} from "./digest";

const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const SNAPSHOT_COPY_PAGE_ROWS = 500;

const ACTIVE_STAGES = ["copying", "repairing", "frozen", "exporting"] as const;

export type SnapshotFence = {
  readonly snapshotId: SnapshotId;
  readonly value: number;
};

export type SnapshotStep =
  | {
      readonly _tag: "advanced";
      readonly fence: SnapshotFence;
      readonly stage: (typeof snapshotJobs.$inferSelect)["stage"];
      readonly stepDueAt: number;
    }
  | {
      readonly _tag: "upload";
      readonly fence: SnapshotFence;
      readonly part: SnapshotPartPayload;
      readonly objectKey: string;
      readonly byteLength: number;
      readonly sha256: string;
    }
  | { readonly _tag: "settled"; readonly manifest: SnapshotManifest }
  | { readonly _tag: "staleFence" }
  | { readonly _tag: "quiescent" };

type SnapshotJobRow = typeof snapshotJobs.$inferSelect;

const utf8 = new TextEncoder();

const decodeEntity = Schema.decodeUnknownSync(SyncEntity);

const loadJob = (
  tx: SqliteConnection,
  organizationId: string,
  snapshotId: string,
): SnapshotJobRow | undefined =>
  tx
    .select()
    .from(snapshotJobs)
    .where(
      and(eq(snapshotJobs.organizationId, organizationId), eq(snapshotJobs.snapshotId, snapshotId)),
    )
    .get();

const loadActiveJob = (
  tx: SqliteConnection,
  organizationId: string,
): SnapshotJobRow | undefined => {
  const jobs = tx
    .select()
    .from(snapshotJobs)
    .where(eq(snapshotJobs.organizationId, organizationId))
    .all();
  return jobs.find((job) => {
    for (const stage of ACTIVE_STAGES) {
      if (job.stage === stage) return true;
    }
    return false;
  });
};

const fenceOf = (job: SnapshotJobRow): SnapshotFence => ({
  snapshotId: SnapshotId.make(job.snapshotId),
  value: job.fence,
});

const advanced = (job: SnapshotJobRow): SnapshotStep => ({
  _tag: "advanced",
  fence: fenceOf(job),
  stage: job.stage,
  stepDueAt: job.stepDueAt,
});

const matchingFence = (job: SnapshotJobRow, fence: SnapshotFence): boolean =>
  job.snapshotId === fence.snapshotId && job.fence === fence.value;

const bump = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
  patch: Partial<{
    readonly stage: SnapshotJobRow["stage"];
    readonly horizon: string | null;
    readonly copyEntity: string | null;
    readonly copyCursor: string | null;
  }>,
  now: number,
): SnapshotJobRow => {
  const nextFence = job.fence + 1;
  runWrite(
    tx
      .update(snapshotJobs)
      .set({ ...patch, fence: nextFence, stepDueAt: now })
      .where(
        and(
          eq(snapshotJobs.organizationId, job.organizationId),
          eq(snapshotJobs.snapshotId, job.snapshotId),
        ),
      ),
  );
  const updated = loadJob(tx, job.organizationId, job.snapshotId);
  if (updated === undefined) {
    throw new Error("Snapshot job disappeared during an in-transaction update.");
  }
  return updated;
};

const firstEntity = (subscription: SyncSubscription): PartitionEntity => {
  const entity = subscriptionEntities(subscription)[0];
  if (entity === undefined) {
    throw new Error("The operational subscription has no snapshot entities.");
  }
  return entity;
};

const jobSubscription = (job: SnapshotJobRow): SyncSubscription =>
  Schema.decodeUnknownSync(SyncSubscription)(job.subscription);

const upsertStaged = (tx: SqliteConnection, job: SnapshotJobRow, row: SnapshotRow): void => {
  const existing = tx
    .select()
    .from(snapshotStagedRows)
    .where(
      and(
        eq(snapshotStagedRows.organizationId, job.organizationId),
        eq(snapshotStagedRows.snapshotId, job.snapshotId),
        eq(snapshotStagedRows.entity, row.entity),
        eq(snapshotStagedRows.entityId, row.entityId),
      ),
    )
    .get();
  if (existing && existing.rowVersion > row.rowVersion) return;
  if (existing) {
    runWrite(
      tx
        .update(snapshotStagedRows)
        .set({ rowVersion: row.rowVersion, rowJson: encodeRowJson(row.row) })
        .where(
          and(
            eq(snapshotStagedRows.organizationId, job.organizationId),
            eq(snapshotStagedRows.snapshotId, job.snapshotId),
            eq(snapshotStagedRows.entity, row.entity),
            eq(snapshotStagedRows.entityId, row.entityId),
          ),
        ),
    );
    return;
  }
  runWrite(
    tx.insert(snapshotStagedRows).values({
      organizationId: job.organizationId,
      snapshotId: job.snapshotId,
      entity: row.entity,
      entityId: row.entityId,
      rowVersion: row.rowVersion,
      rowJson: encodeRowJson(row.row),
    }),
  );
};

const deleteStaged = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
  entity: PartitionEntity,
  entityId: string,
  rowVersion: number,
): void => {
  const existing = tx
    .select()
    .from(snapshotStagedRows)
    .where(
      and(
        eq(snapshotStagedRows.organizationId, job.organizationId),
        eq(snapshotStagedRows.snapshotId, job.snapshotId),
        eq(snapshotStagedRows.entity, entity),
        eq(snapshotStagedRows.entityId, entityId),
      ),
    )
    .get();
  if (existing && existing.rowVersion > rowVersion) return;
  runWrite(
    tx
      .delete(snapshotStagedRows)
      .where(
        and(
          eq(snapshotStagedRows.organizationId, job.organizationId),
          eq(snapshotStagedRows.snapshotId, job.snapshotId),
          eq(snapshotStagedRows.entity, entity),
          eq(snapshotStagedRows.entityId, entityId),
        ),
      ),
  );
};

const applyLogChange = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
  change: typeof inventoryChanges.$inferSelect,
): void => {
  const entity = parsePartitionEntity(change.entity);
  if (entity === undefined) return;
  if (change.action === "delete") {
    deleteStaged(tx, job, entity, change.entityId, change.rowVersion);
    return;
  }
  upsertStaged(tx, job, {
    entity,
    entityId: change.entityId,
    rowVersion: change.rowVersion,
    row: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(change.rowJson),
  });
};

const captureHorizon = (tx: SqliteConnection, job: SnapshotJobRow, now: number): SnapshotJobRow => {
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, job.organizationId))
    .get();
  if (!state) {
    throw new Error("Snapshot capture requires inventory state.");
  }
  return bump(
    tx,
    job,
    {
      stage: "repairing",
      horizon: state.commitSequence,
      copyCursor: job.startedAtCommitSequence,
      copyEntity: null,
    },
    now,
  );
};

const copyPage = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
  now: number,
  pageRows: number,
): SnapshotStep => {
  const subscription = jobSubscription(job);
  const entity = parsePartitionEntity(job.copyEntity ?? "") ?? firstEntity(subscription);
  const page = readPartitionPage(tx, {
    organizationId: job.organizationId,
    entity,
    afterEntityId: job.copyCursor ?? undefined,
    limit: pageRows,
  });
  if (page.length === 0) {
    const next = nextPartitionEntity(subscription, entity);
    if (next === undefined) return advanced(captureHorizon(tx, job, now));
    return advanced(bump(tx, job, { copyEntity: next, copyCursor: null }, now));
  }
  for (const row of page) upsertStaged(tx, job, row);
  const last = page.at(-1);
  if (last === undefined) return advanced(captureHorizon(tx, job, now));
  if (page.length < pageRows) {
    const next = nextPartitionEntity(subscription, entity);
    if (next === undefined) return advanced(captureHorizon(tx, job, now));
    return advanced(bump(tx, job, { copyEntity: next, copyCursor: null }, now));
  }
  return advanced(bump(tx, job, { copyEntity: entity, copyCursor: last.entityId }, now));
};

const repairPage = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
  now: number,
  pageRows: number,
): SnapshotStep => {
  const horizon = job.horizon;
  if (horizon === null) return advanced(captureHorizon(tx, job, now));
  const after = job.copyCursor ?? job.startedAtCommitSequence;
  const headers = tx
    .select()
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, job.organizationId),
        gt(inventoryTransactions.commitSequence, after),
        lte(inventoryTransactions.commitSequence, horizon),
      ),
    )
    .orderBy(asc(inventoryTransactions.commitSequence))
    .limit(pageRows)
    .all();
  if (headers.length === 0) {
    return advanced(bump(tx, job, { stage: "frozen" }, now));
  }
  let repairedThrough = after;
  for (const header of headers) {
    const rows = tx
      .select()
      .from(inventoryChanges)
      .where(
        and(
          eq(inventoryChanges.organizationId, job.organizationId),
          eq(inventoryChanges.commitSequence, header.commitSequence),
        ),
      )
      .orderBy(asc(inventoryChanges.ordinal))
      .all();
    for (const change of rows) applyLogChange(tx, job, change);
    repairedThrough = header.commitSequence;
  }
  return advanced(bump(tx, job, { copyCursor: repairedThrough }, now));
};

const stagedPage = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
  entity: PartitionEntity,
  afterEntityId: string | undefined,
  limit: number,
): ReadonlyArray<typeof snapshotStagedRows.$inferSelect> =>
  tx
    .select()
    .from(snapshotStagedRows)
    .where(
      afterEntityId === undefined
        ? and(
            eq(snapshotStagedRows.organizationId, job.organizationId),
            eq(snapshotStagedRows.snapshotId, job.snapshotId),
            eq(snapshotStagedRows.entity, entity),
          )
        : and(
            eq(snapshotStagedRows.organizationId, job.organizationId),
            eq(snapshotStagedRows.snapshotId, job.snapshotId),
            eq(snapshotStagedRows.entity, entity),
            gt(snapshotStagedRows.entityId, afterEntityId),
          ),
    )
    .orderBy(asc(snapshotStagedRows.entityId))
    .limit(limit)
    .all();

const nextPartNumber = (tx: SqliteConnection, job: SnapshotJobRow): number => {
  const parts = tx
    .select()
    .from(snapshotParts)
    .where(
      and(
        eq(snapshotParts.organizationId, job.organizationId),
        eq(snapshotParts.snapshotId, job.snapshotId),
      ),
    )
    .all();
  let max = 0;
  for (const part of parts) {
    if (part.partNumber > max) max = part.partNumber;
  }
  return max + 1;
};

const collectExportRows = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
):
  | {
      readonly entity: PartitionEntity;
      readonly rows: ReadonlyArray<typeof snapshotStagedRows.$inferSelect>;
    }
  | undefined => {
  const subscription = jobSubscription(job);
  let entity = parsePartitionEntity(job.copyEntity ?? "") ?? firstEntity(subscription);
  let after = job.copyCursor ?? undefined;
  for (;;) {
    const rows = stagedPage(tx, job, entity, after, MAX_SNAPSHOT_PART_ROWS);
    if (rows.length > 0) return { entity, rows };
    const next = nextPartitionEntity(subscription, entity);
    if (next === undefined) return undefined;
    entity = next;
    after = undefined;
  }
};

const toSnapshotRows = (
  rows: ReadonlyArray<typeof snapshotStagedRows.$inferSelect>,
): ReadonlyArray<SnapshotRow> =>
  rows.map((row) => ({
    entity: decodeEntity(row.entity),
    entityId: row.entityId,
    rowVersion: row.rowVersion,
    row: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(row.rowJson),
  }));

type EncodedSnapshotPart = {
  readonly part: SnapshotPartPayload;
  readonly objectKey: string;
  readonly byteLength: number;
  readonly sha256: string;
};

const encodePart = (
  job: SnapshotJobRow,
  partNumber: number,
  rows: ReadonlyArray<typeof snapshotStagedRows.$inferSelect>,
): EncodedSnapshotPart => {
  const part: SnapshotPartPayload = {
    snapshotId: SnapshotId.make(job.snapshotId),
    partNumber,
    rows: toSnapshotRows(rows),
  };
  const encoded = canonicalJson(part) ?? "";
  return {
    part,
    objectKey: `${job.organizationId}/${job.snapshotId}/${job.fence}/${partNumber}`,
    byteLength: utf8.encode(encoded).length,
    sha256: canonicalPayloadHash(part),
  };
};

const entityCounts = (
  tx: SqliteConnection,
  job: SnapshotJobRow,
): SnapshotManifest["entityCounts"] => {
  const subscription = jobSubscription(job);
  return subscriptionEntities(subscription).map((entity) => ({
    entity,
    rowCount: stagedPage(tx, job, entity, undefined, Number.MAX_SAFE_INTEGER).length,
  }));
};

const publishJob = (tx: SqliteConnection, job: SnapshotJobRow, now: number): SnapshotStep => {
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, job.organizationId))
    .get();
  if (!state || job.horizon === null) {
    throw new Error("Snapshot publish requires a captured horizon.");
  }
  const parts = tx
    .select()
    .from(snapshotParts)
    .where(
      and(
        eq(snapshotParts.organizationId, job.organizationId),
        eq(snapshotParts.snapshotId, job.snapshotId),
      ),
    )
    .orderBy(asc(snapshotParts.partNumber))
    .all();
  const manifest: SnapshotManifest = {
    snapshotId: SnapshotId.make(job.snapshotId),
    epoch: SyncEpoch.make(state.epoch),
    subscription: jobSubscription(job),
    schemaVersion: SYNC_SCHEMA_VERSION,
    horizon: OrgCommitSequence.make(unpadDecimalSequence(job.horizon)),
    parts: parts.map((part) => ({
      partNumber: part.partNumber,
      objectKey: part.objectKey,
      byteLength: part.byteLength,
      sha256: part.sha256,
    })),
    entityCounts: entityCounts(tx, job),
  };
  bump(tx, job, { stage: "published" }, now);
  return { _tag: "settled", manifest };
};

const exportStep = (tx: SqliteConnection, job: SnapshotJobRow, now: number): SnapshotStep => {
  const exporting =
    job.stage === "exporting"
      ? job
      : bump(
          tx,
          job,
          { stage: "exporting", copyEntity: firstEntity(jobSubscription(job)), copyCursor: null },
          now,
        );
  const collected = collectExportRows(tx, exporting);
  if (collected === undefined) return publishJob(tx, exporting, now);
  const encoded = encodePart(exporting, nextPartNumber(tx, exporting), collected.rows);
  return {
    _tag: "upload",
    fence: fenceOf(exporting),
    part: encoded.part,
    objectKey: encoded.objectKey,
    byteLength: encoded.byteLength,
    sha256: encoded.sha256,
  };
};

export const startSnapshotJob = (
  tx: SqliteConnection,
  organizationId: string,
  snapshotId: SnapshotId,
  now: number,
): SnapshotStep => {
  const active = loadActiveJob(tx, organizationId);
  if (active) return advanced(active);
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .get();
  if (!state || state.status !== "ready") {
    throw new Error("Snapshot start requires a ready organization.");
  }
  const subscription = OPERATIONAL_SUBSCRIPTION;
  runWrite(
    tx.insert(snapshotJobs).values({
      organizationId,
      snapshotId,
      subscription,
      stage: "copying",
      fence: 1,
      startedAtCommitSequence: state.commitSequence,
      horizon: null,
      copyEntity: firstEntity(subscription),
      copyCursor: null,
      stepDueAt: now,
    }),
  );
  const created = loadJob(tx, organizationId, snapshotId);
  if (created === undefined) {
    throw new Error("Snapshot job insert did not persist.");
  }
  return advanced(created);
};

export const stepSnapshotJob = (
  tx: SqliteConnection,
  organizationId: string,
  fence: SnapshotFence,
  now: number,
  pageRows: number = SNAPSHOT_COPY_PAGE_ROWS,
): SnapshotStep => {
  const job = loadJob(tx, organizationId, fence.snapshotId);
  if (job === undefined) return { _tag: "quiescent" };
  if (!matchingFence(job, fence)) return { _tag: "staleFence" };
  if (job.stage === "published" || job.stage === "failed") return { _tag: "quiescent" };
  if (job.stage === "copying") return copyPage(tx, job, now, pageRows);
  if (job.stage === "repairing") return repairPage(tx, job, now, pageRows);
  if (job.stage === "frozen" || job.stage === "exporting") return exportStep(tx, job, now);
  return { _tag: "quiescent" };
};

export const recordUploadedPart = (
  tx: SqliteConnection,
  organizationId: string,
  fence: SnapshotFence,
  part: SnapshotPartPayload,
  objectKey: string,
  byteLength: number,
  sha256: string,
  now: number,
): SnapshotStep => {
  const job = loadJob(tx, organizationId, fence.snapshotId);
  if (job === undefined) return { _tag: "quiescent" };
  if (!matchingFence(job, fence) || job.stage !== "exporting") return { _tag: "staleFence" };
  const existing = tx
    .select()
    .from(snapshotParts)
    .where(
      and(
        eq(snapshotParts.organizationId, organizationId),
        eq(snapshotParts.snapshotId, job.snapshotId),
        eq(snapshotParts.partNumber, part.partNumber),
      ),
    )
    .get();
  if (existing) {
    if (existing.sha256 === sha256 && existing.objectKey === objectKey) {
      return advanced(job);
    }
    return { _tag: "staleFence" };
  }
  if (part.partNumber !== nextPartNumber(tx, job)) return { _tag: "staleFence" };
  runWrite(
    tx.insert(snapshotParts).values({
      organizationId,
      snapshotId: job.snapshotId,
      partNumber: part.partNumber,
      objectKey,
      byteLength,
      sha256,
    }),
  );
  const last = part.rows.at(-1);
  const updated = bump(
    tx,
    job,
    {
      copyEntity: last === undefined ? job.copyEntity : last.entity,
      copyCursor: last === undefined ? job.copyCursor : last.entityId,
    },
    now,
  );
  return advanced(updated);
};

export const readPublishedManifest = (
  tx: SqliteConnection,
  organizationId: string,
): SnapshotManifest | undefined => {
  const jobs = tx
    .select()
    .from(snapshotJobs)
    .where(
      and(eq(snapshotJobs.organizationId, organizationId), eq(snapshotJobs.stage, "published")),
    )
    .all();
  const job = jobs.at(-1);
  if (job === undefined || job.horizon === null) return undefined;
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .get();
  if (!state) return undefined;
  const parts = tx
    .select()
    .from(snapshotParts)
    .where(
      and(
        eq(snapshotParts.organizationId, organizationId),
        eq(snapshotParts.snapshotId, job.snapshotId),
      ),
    )
    .orderBy(asc(snapshotParts.partNumber))
    .all();
  return {
    snapshotId: SnapshotId.make(job.snapshotId),
    epoch: SyncEpoch.make(state.epoch),
    subscription: jobSubscription(job),
    schemaVersion: SYNC_SCHEMA_VERSION,
    horizon: OrgCommitSequence.make(unpadDecimalSequence(job.horizon)),
    parts: parts.map((part) => ({
      partNumber: part.partNumber,
      objectKey: part.objectKey,
      byteLength: part.byteLength,
      sha256: part.sha256,
    })),
    entityCounts: entityCounts(tx, job),
  };
};
