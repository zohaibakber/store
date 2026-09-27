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
import { and, asc, count, desc, eq, gt, inArray, lte, max, or, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { EncodedSnapshotPart, InventoryActor } from "./model";
import { readPartitionPage } from "./partition";
import {
  databaseError,
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  lockOrganization,
  protocol,
  randomHex,
  requireReady,
  runStatement,
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

type StoredPartRef = {
  readonly partNumber: number;
  readonly objectKey: string;
  readonly byteLength: number;
  readonly sha256: string;
};

const StoredEntityCounts = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number));
const encodeEntityCounts = Schema.encodeSync(StoredEntityCounts);
const decodeEntityCounts = Schema.decodeUnknownEffect(StoredEntityCounts);

const manifestEntityCounts = (
  counts: Readonly<Record<string, number>>,
): SnapshotManifest["entityCounts"] =>
  PARTITION_ENTITIES.map((entity) => ({ entity, rowCount: counts[entity] ?? 0 }));

const buildManifest = (
  snapshotId: SnapshotId,
  epoch: string,
  horizon: string,
  parts: ReadonlyArray<StoredPartRef>,
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

const grantLease = (tx: InventoryDrizzle, lease: typeof downloadLeases.$inferInsert) =>
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

const AcquireLookupRow = Schema.Struct({
  status: Schema.String,
  release_id: Schema.NullOr(Schema.String),
  epoch: Schema.String,
  head: Schema.String,
  replica_owner: Schema.NullOr(Schema.String),
  published_id: Schema.NullOr(Schema.String),
  published_horizon: Schema.NullOr(Schema.String),
  published_counts: Schema.NullOr(Schema.String),
  published_parts: Schema.NullOr(Schema.String),
  active_id: Schema.NullOr(Schema.String),
});

const StoredPartRefs = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      partNumber: Schema.Number,
      objectKey: Schema.String,
      byteLength: Schema.Number,
      sha256: Schema.String,
    }),
  ),
);

const decodeAcquireLookup = Schema.decodeUnknownEffect(Schema.Array(AcquireLookupRow));
const decodeStoredPartRefs = Schema.decodeUnknownEffect(StoredPartRefs);

const acquireLookupStatement = (organizationId: string, replicaId: string | null) => sql`
  select "s"."status", "s"."release_id", "s"."epoch", "s"."commit_sequence"::text as "head",
    "r"."owner_user_id" as "replica_owner",
    "p"."snapshot_id" as "published_id", "p"."horizon"::text as "published_horizon",
    "p"."entity_counts_json" as "published_counts", "parts"."refs" as "published_parts",
    "a"."snapshot_id" as "active_id"
  from "inventory_state" as "s"
  left join "replicas" as "r"
    on "r"."organization_id" = "s"."organization_id" and "r"."replica_id" = ${replicaId}
  left join lateral (
    select "snapshot_id", "horizon", "entity_counts_json"
    from "snapshot_jobs"
    where "organization_id" = "s"."organization_id"
      and "stage" = 'published'
      and "subscription" = ${OPERATIONAL_SUBSCRIPTION}
      and "horizon" is not null
    order by "horizon" desc, "snapshot_id" asc
    limit 1
  ) as "p" on true
  left join lateral (
    select json_agg(
      json_build_object(
        'partNumber', "part_number",
        'objectKey', "object_key",
        'byteLength', "byte_length",
        'sha256', "sha256"
      )
      order by "part_number"
    )::text as "refs"
    from "snapshot_parts"
    where "organization_id" = "s"."organization_id" and "snapshot_id" = "p"."snapshot_id"
  ) as "parts" on true
  left join lateral (
    select "snapshot_id"
    from "snapshot_jobs"
    where "organization_id" = "s"."organization_id"
      and "subscription" = ${OPERATIONAL_SUBSCRIPTION}
      and "stage" in ('copying', 'repairing', 'frozen', 'exporting')
    order by "snapshot_id" asc
    limit 1
  ) as "a" on true
  where "s"."organization_id" = ${organizationId}
`;

const countPublishedPartRows = (organizationId: string, snapshotId: string) => sql`
  update "snapshot_jobs" as "j"
  set "entity_counts_json" = coalesce((
    select json_object_agg("counted"."entity", "counted"."row_count")::text
    from (
      select "row" ->> 'entity' as "entity", count(*) as "row_count"
      from "snapshot_parts" as "p"
      cross join lateral jsonb_array_elements(("p"."payload_json")::jsonb -> 'rows') as "row"
      where "p"."organization_id" = "j"."organization_id"
        and "p"."snapshot_id" = "j"."snapshot_id"
      group by 1
    ) as "counted"
  ), '{}')
  where "j"."organization_id" = ${organizationId}
    and "j"."snapshot_id" = ${snapshotId}
  returning "j"."entity_counts_json" as "counts"
`;

const CountsRow = Schema.Struct({ counts: Schema.NullOr(Schema.String) });
const decodeCountsRows = Schema.decodeUnknownEffect(Schema.Array(CountsRow));

const publishedEntityCounts = Effect.fn("InventorySnapshots.publishedEntityCounts")(function* (
  db: InventoryDrizzle,
  organizationId: string,
  snapshotId: string,
  stored: string | null,
) {
  if (stored !== null) {
    return yield* decodeEntityCounts(stored).pipe(Effect.mapError(databaseError));
  }
  const raw = yield* runStatement(
    db.execute(countPublishedPartRows(organizationId, snapshotId), "objects"),
  );
  const [row] = yield* decodeCountsRows(raw).pipe(Effect.mapError(databaseError));
  return yield* decodeEntityCounts(row?.counts ?? "{}").pipe(Effect.mapError(databaseError));
});

const enqueueOrJoinSnapshotJob = Effect.fn("InventorySnapshots.enqueueOrJoinSnapshotJob")(
  function* (tx: InventoryTransaction, organizationId: string) {
    yield* lockOrganization(tx, organizationId);
    const active = yield* activeJob(tx, organizationId);
    if (active) return SnapshotId.make(active.snapshotId);
    return yield* enqueueSnapshotJobInTransaction(tx, organizationId);
  },
);

const acquireSnapshotWith = Effect.fn("InventorySnapshots.acquireSnapshotWith")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  request: AcquireSnapshotRequest,
  now: number,
  policy: SnapshotRefreshPolicy,
) {
  const transact = runTransaction(db);
  const raw = yield* runStatement(
    db.execute(acquireLookupStatement(actor.organizationId, request.replicaId ?? null), "objects"),
  );
  const [first] = yield* decodeAcquireLookup(raw).pipe(Effect.mapError(databaseError));
  const state = yield* requireReady(
    first === undefined ? undefined : { ...first, releaseId: first.release_id },
  );
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
    if (state.replica_owner === null) {
      return yield* protocol("REPLICA_UNKNOWN", "This replica is not registered.");
    }
    if (state.replica_owner !== actor.userId) {
      return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }
  }

  if (state.published_id === null || state.published_horizon === null) {
    const snapshotId =
      state.active_id === null
        ? yield* transact("read committed", "read write", (tx) =>
            enqueueOrJoinSnapshotJob(tx, actor.organizationId),
          )
        : SnapshotId.make(state.active_id);
    return {
      _tag: "building",
      snapshotId,
      retryAfterMillis: policy.retryAfterMillis,
    } satisfies AcquireSnapshotResult;
  }

  const head = integerTextFromNumeric(state.head);
  const horizon = integerTextFromNumeric(state.published_horizon);
  if (state.active_id === null && snapshotIsStale(head, horizon, policy)) {
    yield* ensureSnapshotJob(db, policy)(actor.organizationId);
  }
  const parts = yield* decodeStoredPartRefs(state.published_parts ?? "[]").pipe(
    Effect.mapError(databaseError),
  );
  const counts = yield* publishedEntityCounts(
    db,
    actor.organizationId,
    state.published_id,
    state.published_counts,
  );
  const manifest = buildManifest(
    SnapshotId.make(state.published_id),
    state.epoch,
    horizon,
    parts,
    manifestEntityCounts(counts),
  );
  if (request.replicaId !== undefined) {
    yield* runStatement(
      grantLease(db, {
        organizationId: actor.organizationId,
        replicaId: request.replicaId,
        snapshotId: manifest.snapshotId,
        pinnedHorizon: manifest.horizon,
        expiresAt: now + LIVE_LEASE_LIFETIME_MILLIS,
      }),
    );
  }
  return { _tag: "ready", manifest } satisfies AcquireSnapshotResult;
});

const readEncodedSnapshotPart = Effect.fn("InventorySnapshots.readEncodedSnapshotPart")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  snapshotId: SnapshotId,
  partNumber: number,
) {
  const [row] = yield* runStatement(
    db
      .select({
        status: inventoryState.status,
        releaseId: inventoryState.releaseId,
        publishedId: snapshotJobs.snapshotId,
        payloadJson: snapshotParts.payloadJson,
        sha256: snapshotParts.sha256,
      })
      .from(inventoryState)
      .leftJoin(
        snapshotJobs,
        and(
          eq(snapshotJobs.organizationId, inventoryState.organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
          eq(snapshotJobs.stage, "published"),
        ),
      )
      .leftJoin(
        snapshotParts,
        and(
          eq(snapshotParts.organizationId, snapshotJobs.organizationId),
          eq(snapshotParts.snapshotId, snapshotJobs.snapshotId),
          eq(snapshotParts.partNumber, partNumber),
        ),
      )
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1),
  );
  const found = yield* requireReady(row);
  if (found.publishedId === null) {
    return yield* protocol("SNAPSHOT_UNAVAILABLE", "No snapshot is published for this id.");
  }
  if (found.payloadJson === null || found.sha256 === null) {
    return yield* protocol("SNAPSHOT_UNAVAILABLE", "The snapshot part does not exist.");
  }
  return { json: found.payloadJson, sha256: found.sha256 } satisfies EncodedSnapshotPart;
});

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
  readonly entityCountsJson?: string;
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

const publishedAdvance = Effect.fn("InventorySnapshots.publishedAdvance")(function* (
  tx: InventoryTransaction,
  job: SnapshotJobRow,
) {
  const counted = yield* tx
    .select({ entity: snapshotStagedRows.entity, rowCount: count() })
    .from(snapshotStagedRows)
    .where(
      and(
        eq(snapshotStagedRows.organizationId, job.organizationId),
        eq(snapshotStagedRows.snapshotId, job.snapshotId),
      ),
    )
    .groupBy(snapshotStagedRows.entity);
  return {
    stage: "published",
    copyCursor: null,
    entityCountsJson: encodeEntityCounts(
      Object.fromEntries(counted.map((row) => [row.entity, row.rowCount])),
    ),
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
    return yield* publishedAdvance(tx, job);
  }
  const rows = yield* decodeStoredRows(staged);
  yield* writeSnapshotPart(tx, job.organizationId, snapshotId, lastPart + 1, rows);
  if (staged.length < MAX_SNAPSHOT_PART_ROWS) {
    return yield* publishedAdvance(tx, job);
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
      entityCountsJson: advance.entityCountsJson ?? job.entityCountsJson,
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
  readonly readSnapshotPartEncoded: (
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<EncodedSnapshotPart, InventoryError>;
}

export class InventorySnapshots extends Context.Service<
  InventorySnapshots,
  InventorySnapshotsContract
>()("@store/server/InventorySnapshots") {}

export const makeInventorySnapshots = (
  db: InventoryDrizzle,
  policy: SnapshotRefreshPolicy = SNAPSHOT_REFRESH_POLICY,
): InventorySnapshotsContract => {
  const readSnapshotPartEncoded = Effect.fn("InventorySnapshots.readSnapshotPartEncoded")(
    function* (actor: InventoryActor, snapshotId: SnapshotId, partNumber: number) {
      return yield* readEncodedSnapshotPart(db, actor, snapshotId, partNumber);
    },
  );
  return InventorySnapshots.of({
    acquireSnapshot: Effect.fn("InventorySnapshots.acquireSnapshot")(function* (actor, request) {
      const now = yield* Clock.currentTimeMillis;
      return yield* acquireSnapshotWith(db, actor, request, now, policy);
    }),
    readSnapshotPart: Effect.fn("InventorySnapshots.readSnapshotPart")(
      function* (actor, snapshotId, partNumber) {
        const encoded = yield* readSnapshotPartEncoded(actor, snapshotId, partNumber);
        return yield* decodePartPayload(encoded.json).pipe(Effect.mapError(databaseError));
      },
    ),
    readSnapshotPartEncoded,
  });
};

export const InventorySnapshotsUnavailable = Layer.succeed(
  InventorySnapshots,
  InventorySnapshots.of({
    acquireSnapshot: () => Effect.fail(inventoryPostgresUnavailable),
    readSnapshotPart: () => Effect.fail(inventoryPostgresUnavailable),
    readSnapshotPartEncoded: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
