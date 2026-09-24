import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  LIVE_LEASE_LIFETIME_MILLIS,
  MAX_SNAPSHOT_PART_ROWS,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartHash,
  SnapshotPartPayload,
  SnapshotRow,
  subscriptionEntities,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  type PartitionEntity,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  downloadLeases,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  snapshotJobs,
  snapshotParts,
  snapshotStagedRows,
} from "@store/db/postgres/schema";
import { and, asc, desc, eq, gt, inArray, lte, max, or, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import { countPartitionRows, readPartitionPage, readPartitionRows } from "./partition";
import {
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  lockOrganization,
  protocol,
  randomHex,
  readReadyState,
  readReplica,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

const PARTITION_ENTITIES = subscriptionEntities(OPERATIONAL_SUBSCRIPTION);

const SNAPSHOT_STEP_POLICY = {
  copyPageRows: 500,
  repairPageTransactions: 200,
  leaseMillis: 30_000,
} as const;

const ACTIVE_SNAPSHOT_STAGES = ["copying", "repairing", "frozen", "exporting"] as const;

type SnapshotJobRow = typeof snapshotJobs.$inferSelect;

type SnapshotStage = SnapshotJobRow["stage"];

const utf8 = new TextEncoder();

const partitionEntityOf = (value: string | null): PartitionEntity =>
  PARTITION_ENTITIES.find((entity) => entity === value) ?? "category";

const isPartitionEntity = (value: string): boolean =>
  PARTITION_ENTITIES.some((entity) => entity === value);

const isActiveStage = (stage: SnapshotStage): boolean =>
  ACTIVE_SNAPSHOT_STAGES.some((active) => active === stage);

const chunkRows = <A>(rows: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  if (rows.length === 0) return [[]];
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

const buildManifest = (
  snapshotId: SnapshotId,
  epoch: string,
  horizon: string,
  parts: ReadonlyArray<typeof snapshotParts.$inferSelect>,
  entityCounts: SnapshotManifest["entityCounts"],
): SnapshotManifest => ({
  snapshotId,
  epoch: SyncEpoch.make(epoch),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: SYNC_SCHEMA_VERSION,
  horizon: OrgCommitSequence.make(integerTextFromNumeric(horizon)),
  parts: parts.map((part) => ({
    partNumber: part.partNumber,
    objectKey: part.objectKey,
    byteLength: part.byteLength,
    sha256: Schema.decodeUnknownSync(SnapshotPartHash)(part.sha256),
  })),
  entityCounts,
});

const encodePartPayload = Schema.encodeSync(Schema.fromJsonString(SnapshotPartPayload));
const decodePartPayload = Schema.decodeUnknownEffect(Schema.fromJsonString(SnapshotPartPayload));

const writeSnapshotPart = Effect.fn("InventorySnapshots.writeSnapshotPart")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  snapshotId: SnapshotId,
  partNumber: number,
  rows: ReadonlyArray<SnapshotRow>,
) {
  const part: SnapshotPartPayload = { snapshotId, partNumber, rows };
  const payloadJson = encodePartPayload(part);
  yield* tx.insert(snapshotParts).values({
    organizationId,
    snapshotId,
    partNumber,
    objectKey: `${organizationId}/${snapshotId}/${partNumber}`,
    byteLength: utf8.encode(payloadJson).length,
    sha256: canonicalPayloadHash(part),
    payloadJson,
  });
});

const readSnapshotParts = (tx: InventoryTransaction, organizationId: string, snapshotId: string) =>
  tx
    .select()
    .from(snapshotParts)
    .where(
      and(
        eq(snapshotParts.organizationId, organizationId),
        eq(snapshotParts.snapshotId, snapshotId),
      ),
    )
    .orderBy(asc(snapshotParts.partNumber));

export type SnapshotRefreshPolicy = {
  readonly lagTransactions: number;
  readonly minimumRebuildMillis: number;
  readonly retryAfterMillis: number;
};

export const SNAPSHOT_REFRESH_POLICY: SnapshotRefreshPolicy = {
  lagTransactions: 2_000,
  minimumRebuildMillis: 15 * 60_000,
  retryAfterMillis: 15_000,
};

const snapshotIsStale = (head: string, horizon: string, policy: SnapshotRefreshPolicy) =>
  BigInt(head) - BigInt(horizon) > BigInt(policy.lagTransactions);

const newestPublishedJob = Effect.fn("InventorySnapshots.newestPublishedJob")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [job] = yield* tx
    .select()
    .from(snapshotJobs)
    .where(
      and(
        eq(snapshotJobs.organizationId, organizationId),
        eq(snapshotJobs.stage, "published"),
        eq(snapshotJobs.subscription, OPERATIONAL_SUBSCRIPTION),
      ),
    )
    .orderBy(desc(snapshotJobs.horizon), asc(snapshotJobs.snapshotId))
    .limit(1);
  return job;
});

const activeJob = Effect.fn("InventorySnapshots.activeJob")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [job] = yield* tx
    .select()
    .from(snapshotJobs)
    .where(
      and(
        eq(snapshotJobs.organizationId, organizationId),
        eq(snapshotJobs.subscription, OPERATIONAL_SUBSCRIPTION),
        inArray(snapshotJobs.stage, [...ACTIVE_SNAPSHOT_STAGES]),
      ),
    )
    .orderBy(asc(snapshotJobs.snapshotId))
    .limit(1);
  return job;
});

const readPublishedManifest = Effect.fn("InventorySnapshots.readPublishedManifest")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  epoch: string,
  snapshotId: string,
  horizon: string,
) {
  const parts = yield* readSnapshotParts(tx, organizationId, snapshotId);
  const entityCounts: Array<SnapshotManifest["entityCounts"][number]> = [];
  for (const entity of PARTITION_ENTITIES) {
    entityCounts.push({ entity, rowCount: yield* countPartitionRows(tx, organizationId, entity) });
  }
  return buildManifest(SnapshotId.make(snapshotId), epoch, horizon, parts, entityCounts);
});

const buildSnapshotSynchronously = Effect.fn("InventorySnapshots.buildSnapshotSynchronously")(
  function* (
    tx: InventoryTransaction,
    organizationId: string,
    epoch: string,
    head: string,
    now: number,
  ) {
    const snapshotId = SnapshotId.make(randomHex(16));
    yield* tx.insert(snapshotJobs).values({
      organizationId,
      snapshotId,
      subscription: OPERATIONAL_SUBSCRIPTION,
      stage: "exporting",
      fence: 1,
      ownerToken: randomHex(8),
      startedAtCommitSequence: head,
      horizon: head,
      copyEntity: null,
      copyCursor: null,
      stepDueAt: now,
    });

    const allRows: SnapshotRow[] = [];
    const entityCounts: Array<SnapshotManifest["entityCounts"][number]> = [];
    for (const entity of PARTITION_ENTITIES) {
      const rows = yield* readPartitionRows(tx, organizationId, entity);
      entityCounts.push({ entity, rowCount: rows.length });
      allRows.push(...rows);
    }

    let partNumber = 1;
    for (const chunk of chunkRows(allRows, MAX_SNAPSHOT_PART_ROWS)) {
      yield* writeSnapshotPart(tx, organizationId, snapshotId, partNumber, chunk);
      partNumber += 1;
    }

    yield* tx
      .update(snapshotJobs)
      .set({ stage: "published", fence: 2, stepDueAt: now })
      .where(
        and(
          eq(snapshotJobs.organizationId, organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
        ),
      );

    const parts = yield* readSnapshotParts(tx, organizationId, snapshotId);
    return buildManifest(snapshotId, epoch, head, parts, entityCounts);
  },
);

const resolveSnapshot = Effect.fn("InventorySnapshots.resolveSnapshot")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  now: number,
  policy: SnapshotRefreshPolicy,
) {
  const state = yield* lockOrganization(tx, actor.organizationId);
  const head = integerTextFromNumeric(state.commitSequence);
  const existing = yield* newestPublishedJob(tx, actor.organizationId);
  const active = yield* activeJob(tx, actor.organizationId);

  if (existing && existing.horizon !== null) {
    const horizon = integerTextFromNumeric(existing.horizon);
    if (!active && snapshotIsStale(head, horizon, policy)) {
      yield* ensureSnapshotJobInTransaction(tx, actor.organizationId, policy);
    }
    const manifest = yield* readPublishedManifest(
      tx,
      actor.organizationId,
      state.epoch,
      existing.snapshotId,
      horizon,
    );
    return { _tag: "ready", manifest } satisfies AcquireSnapshotResult;
  }

  if (active) {
    return {
      _tag: "building",
      snapshotId: SnapshotId.make(active.snapshotId),
      retryAfterMillis: policy.retryAfterMillis,
    } satisfies AcquireSnapshotResult;
  }

  const manifest = yield* buildSnapshotSynchronously(
    tx,
    actor.organizationId,
    state.epoch,
    head,
    now,
  );
  return { _tag: "ready", manifest } satisfies AcquireSnapshotResult;
});

const grantLease = (tx: InventoryTransaction, lease: typeof downloadLeases.$inferInsert) =>
  tx
    .insert(downloadLeases)
    .values(lease)
    .onConflictDoUpdate({
      target: [downloadLeases.organizationId, downloadLeases.replicaId],
      set: {
        snapshotId: lease.snapshotId,
        pinnedHorizon: lease.pinnedHorizon,
        expiresAt: lease.expiresAt,
      },
    });

const acquireSnapshotInTransaction = Effect.fn("InventorySnapshots.acquireSnapshotInTransaction")(
  function* (
    tx: InventoryTransaction,
    actor: InventoryActor,
    request: AcquireSnapshotRequest,
    now: number,
    policy: SnapshotRefreshPolicy,
  ) {
    const state = yield* readReadyState(tx, actor.organizationId);
    if (state.epoch !== request.epoch) {
      return yield* protocol("EPOCH_MISMATCH", "The replica epoch does not match.");
    }
    if (request.subscription !== OPERATIONAL_SUBSCRIPTION) {
      return yield* protocol(
        "SCHEMA_VERSION_UNSUPPORTED",
        "Only the operational subscription is published.",
      );
    }
    if (request.replicaId !== undefined) {
      const replica = yield* readReplica(tx, actor.organizationId, request.replicaId);
      if (!replica) {
        return yield* protocol("REPLICA_UNKNOWN", "This replica is not registered.");
      }
      if (replica.ownerUserId !== actor.userId) {
        return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
      }
    }

    const result: AcquireSnapshotResult = yield* resolveSnapshot(tx, actor, now, policy);
    if (request.replicaId !== undefined && result._tag === "ready") {
      yield* grantLease(tx, {
        organizationId: actor.organizationId,
        replicaId: request.replicaId,
        snapshotId: result.manifest.snapshotId,
        pinnedHorizon: result.manifest.horizon,
        expiresAt: now + LIVE_LEASE_LIFETIME_MILLIS,
      });
    }
    return result;
  },
);

const readSnapshotPartInTransaction = Effect.fn("InventorySnapshots.readSnapshotPartInTransaction")(
  function* (
    tx: InventoryTransaction,
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) {
    yield* readReadyState(tx, actor.organizationId);

    const [job] = yield* tx
      .select()
      .from(snapshotJobs)
      .where(
        and(
          eq(snapshotJobs.organizationId, actor.organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
          eq(snapshotJobs.stage, "published"),
        ),
      )
      .limit(1);
    if (!job) {
      return yield* protocol("SNAPSHOT_UNAVAILABLE", "No snapshot is published for this id.");
    }

    const [part] = yield* tx
      .select()
      .from(snapshotParts)
      .where(
        and(
          eq(snapshotParts.organizationId, actor.organizationId),
          eq(snapshotParts.snapshotId, snapshotId),
          eq(snapshotParts.partNumber, partNumber),
        ),
      )
      .limit(1);
    if (!part) {
      return yield* protocol("SNAPSHOT_UNAVAILABLE", "The snapshot part does not exist.");
    }

    return yield* decodePartPayload(part.payloadJson);
  },
);

export type SnapshotStepProgress = {
  readonly organizationId: string;
  readonly snapshotId: string | null;
  readonly stage: SnapshotStage | null;
  readonly advanced: boolean;
  readonly fenced: boolean;
};

type StageAdvance = {
  readonly stage?: SnapshotStage;
  readonly horizon?: string;
  readonly copyEntity?: string | null;
  readonly copyCursor?: string | null;
};

const ExportCursor = Schema.Struct({ entity: Schema.String, entityId: Schema.String });

const encodeExportCursor = Schema.encodeSync(Schema.fromJsonString(ExportCursor));
const decodeExportCursor = Schema.decodeUnknownSync(Schema.fromJsonString(ExportCursor));
const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeRowJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeSnapshotRows = Schema.decodeUnknownEffect(Schema.Array(SnapshotRow));

const decodeStoredRows = (
  rows: ReadonlyArray<{
    readonly entity: string;
    readonly entityId: string;
    readonly rowVersion: number;
    readonly rowJson: string;
  }>,
) =>
  decodeSnapshotRows(
    rows.map((row) => ({
      entity: row.entity,
      entityId: row.entityId,
      rowVersion: row.rowVersion,
      row: decodeRowJson(row.rowJson),
    })),
  );

const databaseNowMillis = Effect.fn("InventorySnapshots.databaseNowMillis")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [row] = yield* tx
    .select({ now: sql<number>`(extract(epoch from now()) * 1000)::double precision` })
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .limit(1);
  return Math.trunc(Number(row?.now ?? 0));
});

const stageRows = Effect.fn("InventorySnapshots.stageRows")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  snapshotId: string,
  rows: ReadonlyArray<SnapshotRow>,
) {
  if (rows.length === 0) return;
  yield* tx
    .insert(snapshotStagedRows)
    .values(
      rows.map((row) => ({
        organizationId,
        snapshotId,
        entity: row.entity,
        entityId: row.entityId,
        rowVersion: row.rowVersion,
        rowJson: encodeRowJson(row.row),
      })),
    )
    .onConflictDoUpdate({
      target: [
        snapshotStagedRows.organizationId,
        snapshotStagedRows.snapshotId,
        snapshotStagedRows.entity,
        snapshotStagedRows.entityId,
      ],
      set: { rowVersion: sql`excluded.row_version`, rowJson: sql`excluded.row_json` },
    });
});

const stepCopying = Effect.fn("InventorySnapshots.stepCopying")(function* (
  tx: InventoryTransaction,
  job: SnapshotJobRow,
) {
  const entity = partitionEntityOf(job.copyEntity);
  const rows = yield* readPartitionPage(
    tx,
    job.organizationId,
    entity,
    job.copyCursor ?? undefined,
    SNAPSHOT_STEP_POLICY.copyPageRows,
  );
  yield* stageRows(tx, job.organizationId, job.snapshotId, rows);
  if (rows.length === SNAPSHOT_STEP_POLICY.copyPageRows) {
    return {
      copyEntity: entity,
      copyCursor: rows[rows.length - 1]?.entityId ?? null,
    } satisfies StageAdvance;
  }
  const next = PARTITION_ENTITIES[PARTITION_ENTITIES.indexOf(entity) + 1];
  return next
    ? ({ copyEntity: next, copyCursor: null } satisfies StageAdvance)
    : ({ stage: "repairing", copyEntity: null, copyCursor: null } satisfies StageAdvance);
});

const stepRepairing = Effect.fn("InventorySnapshots.stepRepairing")(function* (
  tx: InventoryTransaction,
  job: SnapshotJobRow,
) {
  if (job.horizon === null) {
    const state = yield* lockOrganization(tx, job.organizationId);
    return {
      horizon: integerTextFromNumeric(state.commitSequence),
      copyCursor: integerTextFromNumeric(job.startedAtCommitSequence),
    } satisfies StageAdvance;
  }
  const horizon = integerTextFromNumeric(job.horizon);
  const cursor = integerTextFromNumeric(job.copyCursor ?? job.startedAtCommitSequence);
  const groups = yield* tx
    .select({ commitSequence: inventoryTransactions.commitSequence })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, job.organizationId),
        gt(inventoryTransactions.commitSequence, cursor),
        lte(inventoryTransactions.commitSequence, horizon),
      ),
    )
    .orderBy(asc(inventoryTransactions.commitSequence))
    .limit(SNAPSHOT_STEP_POLICY.repairPageTransactions);
  if (groups.length === 0) {
    return { stage: "frozen", copyCursor: null } satisfies StageAdvance;
  }
  const sequences = groups.map((group) => group.commitSequence);
  const changes = yield* tx
    .select()
    .from(inventoryChanges)
    .where(
      and(
        eq(inventoryChanges.organizationId, job.organizationId),
        inArray(inventoryChanges.commitSequence, sequences),
      ),
    )
    .orderBy(asc(inventoryChanges.commitSequence), asc(inventoryChanges.ordinal));
  for (const change of changes) {
    if (!isPartitionEntity(change.entity)) continue;
    if (change.action === "delete") {
      yield* tx
        .delete(snapshotStagedRows)
        .where(
          and(
            eq(snapshotStagedRows.organizationId, job.organizationId),
            eq(snapshotStagedRows.snapshotId, job.snapshotId),
            eq(snapshotStagedRows.entity, change.entity),
            eq(snapshotStagedRows.entityId, change.entityId),
          ),
        );
      continue;
    }
    const staged = yield* decodeStoredRows([change]);
    yield* stageRows(tx, job.organizationId, job.snapshotId, staged);
  }
  return {
    copyCursor: sequences[sequences.length - 1] ?? cursor,
  } satisfies StageAdvance;
});

const stepExporting = Effect.fn("InventorySnapshots.stepExporting")(function* (
  tx: InventoryTransaction,
  job: SnapshotJobRow,
) {
  const cursor = job.copyCursor === null ? undefined : decodeExportCursor(job.copyCursor);
  const staged = yield* tx
    .select()
    .from(snapshotStagedRows)
    .where(
      and(
        eq(snapshotStagedRows.organizationId, job.organizationId),
        eq(snapshotStagedRows.snapshotId, job.snapshotId),
        cursor === undefined
          ? undefined
          : or(
              gt(snapshotStagedRows.entity, cursor.entity),
              and(
                eq(snapshotStagedRows.entity, cursor.entity),
                gt(snapshotStagedRows.entityId, cursor.entityId),
              ),
            ),
      ),
    )
    .orderBy(asc(snapshotStagedRows.entity), asc(snapshotStagedRows.entityId))
    .limit(MAX_SNAPSHOT_PART_ROWS);
  const [partState] = yield* tx
    .select({ partNumber: max(snapshotParts.partNumber) })
    .from(snapshotParts)
    .where(
      and(
        eq(snapshotParts.organizationId, job.organizationId),
        eq(snapshotParts.snapshotId, job.snapshotId),
      ),
    );
  const lastPart = partState?.partNumber ?? 0;
  const snapshotId = SnapshotId.make(job.snapshotId);
  if (staged.length === 0) {
    if (lastPart === 0) {
      yield* writeSnapshotPart(tx, job.organizationId, snapshotId, 1, []);
    }
    return { stage: "published", copyCursor: null } satisfies StageAdvance;
  }
  const rows = yield* decodeStoredRows(staged);
  yield* writeSnapshotPart(tx, job.organizationId, snapshotId, lastPart + 1, rows);
  if (staged.length < MAX_SNAPSHOT_PART_ROWS) {
    return { stage: "published", copyCursor: null } satisfies StageAdvance;
  }
  const last = staged[staged.length - 1];
  return {
    copyCursor:
      last === undefined
        ? null
        : encodeExportCursor({ entity: last.entity, entityId: last.entityId }),
  } satisfies StageAdvance;
});

const advanceStage = Effect.fn("InventorySnapshots.advanceStage")(function* (
  tx: InventoryTransaction,
  job: SnapshotJobRow,
) {
  switch (job.stage) {
    case "copying":
      return yield* stepCopying(tx, job);
    case "repairing":
      return yield* stepRepairing(tx, job);
    case "frozen":
      return { stage: "exporting", copyCursor: null } satisfies StageAdvance;
    case "exporting":
      return yield* stepExporting(tx, job);
    default:
      return {} satisfies StageAdvance;
  }
});

const enqueueSnapshotJobInTransaction = Effect.fn("InventorySnapshots.enqueueSnapshotJob")(
  function* (tx: InventoryTransaction, organizationId: string) {
    const state = yield* lockOrganization(tx, organizationId);
    const now = yield* databaseNowMillis(tx, organizationId);
    const snapshotId = SnapshotId.make(randomHex(16));
    yield* tx.insert(snapshotJobs).values({
      organizationId,
      snapshotId,
      subscription: OPERATIONAL_SUBSCRIPTION,
      stage: "copying",
      fence: 0,
      ownerToken: null,
      startedAtCommitSequence: integerTextFromNumeric(state.commitSequence),
      horizon: null,
      copyEntity: null,
      copyCursor: null,
      stepDueAt: now,
    });
    return snapshotId;
  },
);

export const claimSnapshotJobInTransaction = Effect.fn("InventorySnapshots.claimSnapshotJob")(
  function* (tx: InventoryTransaction, organizationId: string) {
    const now = yield* databaseNowMillis(tx, organizationId);
    const [job] = yield* tx
      .select()
      .from(snapshotJobs)
      .where(
        and(
          eq(snapshotJobs.organizationId, organizationId),
          inArray(snapshotJobs.stage, [...ACTIVE_SNAPSHOT_STAGES]),
          lte(snapshotJobs.stepDueAt, now),
        ),
      )
      .orderBy(asc(snapshotJobs.snapshotId))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!job) return undefined;
    const fence = job.fence + 1;
    const ownerToken = randomHex(8);
    yield* tx
      .update(snapshotJobs)
      .set({ fence, ownerToken, stepDueAt: now + SNAPSHOT_STEP_POLICY.leaseMillis })
      .where(
        and(
          eq(snapshotJobs.organizationId, organizationId),
          eq(snapshotJobs.snapshotId, job.snapshotId),
          eq(snapshotJobs.fence, job.fence),
        ),
      );
    return { snapshotId: job.snapshotId, fence, ownerToken };
  },
);

export const stepClaimedSnapshotJobInTransaction = Effect.fn(
  "InventorySnapshots.stepClaimedSnapshotJob",
)(function* (
  tx: InventoryTransaction,
  organizationId: string,
  snapshotId: string,
  fence: number,
  ownerToken: string,
) {
  const now = yield* databaseNowMillis(tx, organizationId);
  const [job] = yield* tx
    .select()
    .from(snapshotJobs)
    .where(
      and(eq(snapshotJobs.organizationId, organizationId), eq(snapshotJobs.snapshotId, snapshotId)),
    )
    .for("update")
    .limit(1);
  if (!job || job.fence !== fence || job.ownerToken !== ownerToken) {
    return { _tag: "fenced" as const, stage: job?.stage ?? null };
  }
  if (!isActiveStage(job.stage)) {
    return { _tag: "settled" as const, stage: job.stage };
  }
  const advance: StageAdvance = yield* advanceStage(tx, job);
  yield* tx
    .update(snapshotJobs)
    .set({
      stage: advance.stage ?? job.stage,
      horizon: advance.horizon ?? job.horizon,
      copyEntity: advance.copyEntity === undefined ? job.copyEntity : advance.copyEntity,
      copyCursor: advance.copyCursor === undefined ? job.copyCursor : advance.copyCursor,
      ownerToken: null,
      stepDueAt: now,
    })
    .where(
      and(
        eq(snapshotJobs.organizationId, organizationId),
        eq(snapshotJobs.snapshotId, snapshotId),
        eq(snapshotJobs.fence, fence),
        eq(snapshotJobs.ownerToken, ownerToken),
      ),
    );
  return { _tag: "advanced" as const, stage: advance.stage ?? job.stage };
});

const ensureSnapshotJobInTransaction = Effect.fn("InventorySnapshots.ensureSnapshotJob")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  policy: SnapshotRefreshPolicy,
) {
  const state = yield* lockOrganization(tx, organizationId);
  const active = yield* activeJob(tx, organizationId);
  if (active) return undefined;
  const newest = yield* newestPublishedJob(tx, organizationId);
  if (!newest || newest.horizon === null) {
    return yield* enqueueSnapshotJobInTransaction(tx, organizationId);
  }
  const head = integerTextFromNumeric(state.commitSequence);
  if (!snapshotIsStale(head, integerTextFromNumeric(newest.horizon), policy)) return undefined;
  const now = yield* databaseNowMillis(tx, organizationId);
  if (now - newest.stepDueAt < policy.minimumRebuildMillis) return undefined;
  return yield* enqueueSnapshotJobInTransaction(tx, organizationId);
});

export const enqueueSnapshotJob =
  (db: InventoryDrizzle) =>
  (organizationId: string): Effect.Effect<SnapshotId, InventoryError> =>
    runTransaction(db)("read committed", "read write", (tx) =>
      enqueueSnapshotJobInTransaction(tx, organizationId),
    );

export const ensureSnapshotJob =
  (db: InventoryDrizzle, policy: SnapshotRefreshPolicy = SNAPSHOT_REFRESH_POLICY) =>
  (organizationId: string): Effect.Effect<SnapshotId | undefined, InventoryError> =>
    runTransaction(db)("read committed", "read write", (tx) =>
      ensureSnapshotJobInTransaction(tx, organizationId, policy),
    );

export const stepSnapshotJobs =
  (db: InventoryDrizzle) =>
  (organizationId: string): Effect.Effect<SnapshotStepProgress, InventoryError> =>
    Effect.gen(function* () {
      const transact = runTransaction(db);
      const claim = yield* transact("read committed", "read write", (tx) =>
        claimSnapshotJobInTransaction(tx, organizationId),
      );
      if (!claim) {
        return {
          organizationId,
          snapshotId: null,
          stage: null,
          advanced: false,
          fenced: false,
        } satisfies SnapshotStepProgress;
      }
      const outcome = yield* transact("read committed", "read write", (tx) =>
        stepClaimedSnapshotJobInTransaction(
          tx,
          organizationId,
          claim.snapshotId,
          claim.fence,
          claim.ownerToken,
        ),
      );
      return {
        organizationId,
        snapshotId: claim.snapshotId,
        stage: outcome.stage,
        advanced: outcome._tag === "advanced",
        fenced: outcome._tag === "fenced",
      } satisfies SnapshotStepProgress;
    });

export interface InventorySnapshotsContract {
  readonly acquireSnapshot: (
    actor: InventoryActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, InventoryError>;
  readonly readSnapshotPart: (
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<SnapshotPartPayload, InventoryError>;
}

export class InventorySnapshots extends Context.Service<
  InventorySnapshots,
  InventorySnapshotsContract
>()("@store/server/InventorySnapshots") {}

export const makeInventorySnapshots = (
  db: InventoryDrizzle,
  policy: SnapshotRefreshPolicy = SNAPSHOT_REFRESH_POLICY,
): InventorySnapshotsContract => {
  const transact = runTransaction(db);
  return InventorySnapshots.of({
    acquireSnapshot: Effect.fn("InventorySnapshots.acquireSnapshot")(function* (actor, request) {
      const now = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        acquireSnapshotInTransaction(tx, actor, request, now, policy),
      );
    }),
    readSnapshotPart: Effect.fn("InventorySnapshots.readSnapshotPart")(
      function* (actor, snapshotId, partNumber) {
        return yield* transact("repeatable read", "read only", (tx) =>
          readSnapshotPartInTransaction(tx, actor, snapshotId, partNumber),
        );
      },
    ),
  });
};

export const InventorySnapshotsUnavailable = Layer.succeed(
  InventorySnapshots,
  InventorySnapshots.of({
    acquireSnapshot: () => Effect.fail(inventoryPostgresUnavailable),
    readSnapshotPart: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
