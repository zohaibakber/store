import * as PgClient from "@effect/sql-pg/PgClient";
import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence, SyncProtocolError } from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
} from "@store/contracts/sync/fixtures";
import {
  batches,
  categories,
  commandReceipts,
  consumedTickets,
  downloadLeases,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  products,
  replicas,
  snapshotJobs,
  snapshotParts,
} from "@store/db/postgres/schema";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { makeInventoryMaintenance } from "../../src/inventory/maintenance";
import type { InventoryActor } from "../../src/inventory/model";
import { runTransaction, type InventoryDrizzle } from "../../src/inventory/postgres";
import { runRetentionStep, type RetentionPolicy } from "../../src/inventory/retention";
import {
  claimSnapshotJobInTransaction,
  enqueueSnapshotJob,
  ensureSnapshotJob,
  makeInventorySnapshots,
  stepClaimedSnapshotJobInTransaction,
  stepSnapshotJobs,
  type SnapshotRefreshPolicy,
} from "../../src/inventory/snapshots";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);

let database: AuthorityPostgres;

const StagedPartRows = Schema.Struct({
  rows: Schema.Array(Schema.Struct({ entity: Schema.String, entityId: Schema.String })),
});

const OCCURRED_AT = 1_700_000_000_000;

const TEST_POLICY: RetentionPolicy = {
  minimumRetainedTransactions: 2,
  deleteBatchTransactions: 2,
  deleteBatchesPerStep: 2,
  expiredLeaseBatchRows: 50,
  expiredTicketBatchRows: 2,
  abandonedSnapshotJobMillis: 60_000,
  abandonedSnapshotJobBatchRows: 10,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
};

const TEST_REFRESH: SnapshotRefreshPolicy = {
  lagTransactions: 2,
  minimumRebuildMillis: 0,
  retryAfterMillis: 1_000,
};

const layer = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-retention-tests",
  });

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer()), Effect.scoped));

const actorFor = (organizationId: string): InventoryActor => ({
  organizationId,
  userId: "user-1",
});

const openDrizzle = Effect.gen(function* () {
  const client = yield* PgClient.PgClient;
  return yield* PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));
});

const seedCatalog = (db: InventoryDrizzle, organizationId: string) =>
  Effect.gen(function* () {
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
      organizationId,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-category",
      rowVersion: 1,
    });
    yield* db.insert(products).values({
      id: LAST_UNIT_PRODUCT_ID,
      name: "Last unit",
      categoryId: "general",
      aisle: null,
      composition: null,
      strength: null,
      unitsPerPack: 1,
      purchasePrice: 50,
      retailPrice: 100,
      unitPrice: 100,
      visible: true,
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
      deletedAt: null,
      organizationId,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-product",
      rowVersion: 1,
    });
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 10,
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
      deletedAt: null,
      organizationId,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-batch",
      rowVersion: 1,
    });
  });

const seedOrganization = (organizationId: string, head: number) =>
  Effect.gen(function* () {
    const db = yield* openDrizzle;
    yield* db.insert(inventoryState).values({
      organizationId,
      status: "ready",
      importId: "import-test",
      releaseId: "release-test",
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: String(head),
      retentionFloor: "0",
    });
    yield* db.insert(replicas).values({
      organizationId,
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: "user-1",
      deviceLabel: LAST_UNIT_REPLICA_A,
      lastClientSequence: String(head),
      processedThroughClientSequence: String(head),
      registeredAt: OCCURRED_AT,
      lastSeenAt: OCCURRED_AT,
    });
    yield* seedCatalog(db, organizationId);
    for (let sequence = 1; sequence <= head; sequence += 1) {
      yield* db.insert(inventoryTransactions).values({
        organizationId,
        commitSequence: String(sequence),
        operationId: `op-${sequence}`,
        decision: "accepted",
        epoch: LAST_UNIT_EPOCH,
      });
      yield* db.insert(inventoryChanges).values({
        organizationId,
        commitSequence: String(sequence),
        ordinal: 0,
        entity: "product",
        action: "upsert",
        entityId: LAST_UNIT_PRODUCT_ID,
        rowVersion: sequence,
        rowJson: JSON.stringify({ id: LAST_UNIT_PRODUCT_ID, rowVersion: sequence }),
      });
      yield* db.insert(commandReceipts).values({
        organizationId,
        operationId: `op-${sequence}`,
        replicaId: LAST_UNIT_REPLICA_A,
        clientSequence: String(sequence),
        payloadHash: `hash-${sequence}`,
        decision: "accepted",
        commitSequence: String(sequence),
        resultJson: JSON.stringify({ _tag: "accepted" }),
        receivedAt: OCCURRED_AT,
        attempts: 1,
      });
    }
    return db;
  });

const publishSnapshotJob = (
  db: InventoryDrizzle,
  organizationId: string,
  snapshotId: string,
  horizon: string,
) =>
  db.insert(snapshotJobs).values({
    organizationId,
    snapshotId,
    subscription: OPERATIONAL_SUBSCRIPTION,
    stage: "published",
    fence: 1,
    ownerToken: null,
    startedAtCommitSequence: horizon,
    horizon,
    copyEntity: null,
    copyCursor: null,
    stepDueAt: OCCURRED_AT,
  });

const grantLease = (
  db: InventoryDrizzle,
  organizationId: string,
  replicaId: string,
  snapshotId: string,
  pinnedHorizon: string,
  expiresAt: number,
) =>
  db.insert(downloadLeases).values({
    organizationId,
    replicaId,
    snapshotId,
    pinnedHorizon,
    expiresAt,
  });

const readFloor = (db: InventoryDrizzle, organizationId: string) =>
  Effect.gen(function* () {
    const [state] = yield* db
      .select({ retentionFloor: inventoryState.retentionFloor })
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, organizationId))
      .limit(1);
    return state?.retentionFloor ?? null;
  });

const readJob = (db: InventoryDrizzle, organizationId: string, snapshotId: string) =>
  Effect.gen(function* () {
    const [job] = yield* db
      .select()
      .from(snapshotJobs)
      .where(
        and(
          eq(snapshotJobs.organizationId, organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
        ),
      )
      .limit(1);
    return job;
  });

describe("postgres inventory retention", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("advances the floor to the smallest of snapshot horizon, lease cursor, and head minus the minimum", async () => {
    const organizationId = decodeOrganizationId("org-floor-min");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshotJob(db, organizationId, "snapshot-min", "6");
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_A,
          "snapshot-min",
          "4",
          OCCURRED_AT + 600_000,
        );
        const withLease = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        yield* db.delete(downloadLeases).where(eq(downloadLeases.organizationId, organizationId));
        const withoutLease = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        return { withLease, withoutLease };
      }),
    );
    expect(outcome.withLease.floorBefore).toBe("0");
    expect(outcome.withLease.floorAfter).toBe("4");
    expect(outcome.withoutLease.floorAfter).toBe("6");
  });

  it("never regresses the retention floor", async () => {
    const organizationId = decodeOrganizationId("org-floor-monotonic");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshotJob(db, organizationId, "snapshot-monotonic", "6");
        const first = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_A,
          "snapshot-monotonic",
          "1",
          OCCURRED_AT + 600_000,
        );
        const second = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        return { first, second, floor: yield* readFloor(db, organizationId) };
      }),
    );
    expect(outcome.first.floorAfter).toBe("6");
    expect(outcome.second.floorBefore).toBe("6");
    expect(outcome.second.floorAfter).toBe("6");
    expect(outcome.floor).toBe("6");
  });

  it("deletes history below the floor in bounded batches and keeps command receipts", async () => {
    const organizationId = decodeOrganizationId("org-bounded-delete");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshotJob(db, organizationId, "snapshot-bounded", "10");
        const first = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const second = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const third = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const remainingTransactions = yield* db
          .select({ commitSequence: inventoryTransactions.commitSequence })
          .from(inventoryTransactions)
          .where(eq(inventoryTransactions.organizationId, organizationId));
        const remainingChanges = yield* db
          .select({ commitSequence: inventoryChanges.commitSequence })
          .from(inventoryChanges)
          .where(eq(inventoryChanges.organizationId, organizationId));
        const receipts = yield* db
          .select({ operationId: commandReceipts.operationId })
          .from(commandReceipts)
          .where(eq(commandReceipts.organizationId, organizationId));
        return { first, second, third, remainingTransactions, remainingChanges, receipts };
      }),
    );
    expect(outcome.first.floorAfter).toBe("8");
    expect(outcome.first.deletedTransactions).toBe(4);
    expect(outcome.first.more).toBe(true);
    expect(outcome.second.deletedTransactions).toBe(4);
    expect(outcome.second.more).toBe(false);
    expect(outcome.third.deletedTransactions).toBe(0);
    expect(outcome.third.more).toBe(false);
    expect(outcome.remainingTransactions.map((row) => row.commitSequence)).toEqual(["9", "10"]);
    expect(outcome.remainingChanges).toHaveLength(2);
    expect(outcome.receipts).toHaveLength(10);
  });

  it("refuses a pull below the new floor and serves a pull above it", async () => {
    const organizationId = decodeOrganizationId("org-pull-floor");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshotJob(db, organizationId, "snapshot-pull", "6");
        const commands = makeInventoryCommands(db);
        const beforeRetention = yield* commands.pull(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
          afterCommitSequence: OrgCommitSequence.make("0"),
        });
        const progress = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const belowFloor = yield* commands
          .pull(actor, {
            epoch: LAST_UNIT_EPOCH,
            subscription: OPERATIONAL_SUBSCRIPTION,
            afterCommitSequence: OrgCommitSequence.make("0"),
          })
          .pipe(Effect.flip);
        const atFloor = yield* commands.pull(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
          afterCommitSequence: OrgCommitSequence.make("6"),
        });
        return { beforeRetention, progress, belowFloor, atFloor };
      }),
    );
    expect(outcome.beforeRetention.transactions).toHaveLength(10);
    expect(outcome.progress.floorAfter).toBe("6");
    expect(isProtocol(outcome.belowFloor) && outcome.belowFloor.code).toBe("SNAPSHOT_REQUIRED");
    expect(outcome.atFloor.retentionFloor).toBe(OrgCommitSequence.make("6"));
    expect(outcome.atFloor.transactions.map((group) => group.commitSequence)).toEqual([
      OrgCommitSequence.make("7"),
      OrgCommitSequence.make("8"),
      OrgCommitSequence.make("9"),
      OrgCommitSequence.make("10"),
    ]);
  });

  it("expires stale download leases and keeps active ones", async () => {
    const organizationId = decodeOrganizationId("org-lease-expiry");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 4);
        yield* publishSnapshotJob(db, organizationId, "snapshot-lease", "2");
        yield* db.insert(replicas).values({
          organizationId,
          replicaId: LAST_UNIT_REPLICA_B,
          ownerUserId: "user-1",
          deviceLabel: LAST_UNIT_REPLICA_B,
          lastClientSequence: "0",
          processedThroughClientSequence: "0",
          registeredAt: OCCURRED_AT,
          lastSeenAt: OCCURRED_AT,
        });
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_A,
          "snapshot-lease",
          "1",
          OCCURRED_AT - 1,
        );
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_B,
          "snapshot-lease",
          "2",
          OCCURRED_AT + 600_000,
        );
        yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        return yield* db
          .select({ replicaId: downloadLeases.replicaId })
          .from(downloadLeases)
          .where(eq(downloadLeases.organizationId, organizationId))
          .orderBy(asc(downloadLeases.replicaId));
      }),
    );
    expect(outcome.map((row) => row.replicaId)).toEqual([LAST_UNIT_REPLICA_B]);
  });

  it("resumes a snapshot job after an expired lease and refuses a stale fence", async () => {
    const organizationId = decodeOrganizationId("org-snapshot-step");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        const transact = runTransaction(db);
        const snapshotId = yield* enqueueSnapshotJob(db)(organizationId);
        const abandoned = yield* transact("read committed", "read write", (tx) =>
          claimSnapshotJobInTransaction(tx, organizationId),
        );
        yield* db
          .update(snapshotJobs)
          .set({ stepDueAt: 0 })
          .where(
            and(
              eq(snapshotJobs.organizationId, organizationId),
              eq(snapshotJobs.snapshotId, snapshotId),
            ),
          );
        const resumed = yield* stepSnapshotJobs(db)(organizationId);
        const stale = yield* transact("read committed", "read write", (tx) =>
          stepClaimedSnapshotJobInTransaction(
            tx,
            organizationId,
            snapshotId,
            abandoned?.fence ?? 0,
            abandoned?.ownerToken ?? "",
          ),
        );
        const steps: Array<string | null> = [];
        for (let index = 0; index < 20; index += 1) {
          const progress = yield* stepSnapshotJobs(db)(organizationId);
          steps.push(progress.stage);
          if (progress.stage === "published" || progress.snapshotId === null) break;
        }
        const job = yield* readJob(db, organizationId, snapshotId);
        const parts = yield* db
          .select({ partNumber: snapshotParts.partNumber })
          .from(snapshotParts)
          .where(
            and(
              eq(snapshotParts.organizationId, organizationId),
              eq(snapshotParts.snapshotId, snapshotId),
            ),
          );
        return { abandoned, resumed, stale, steps, job, parts };
      }),
    );
    expect(outcome.abandoned?.fence).toBe(1);
    expect(outcome.resumed.fenced).toBe(false);
    expect(outcome.resumed.advanced).toBe(true);
    expect(outcome.stale._tag).toBe("fenced");
    expect(outcome.job?.stage).toBe("published");
    expect(outcome.job?.horizon).not.toBeNull();
    expect(outcome.parts.length).toBeGreaterThan(0);
  }, 60_000);

  it("replays only snapshot entities while repairing a staged snapshot", async () => {
    const organizationId = decodeOrganizationId("org-snapshot-repair-filter");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        const snapshotId = yield* enqueueSnapshotJob(db)(organizationId);
        yield* db.insert(inventoryTransactions).values({
          organizationId,
          commitSequence: "4",
          operationId: "op-4",
          decision: "accepted",
          epoch: LAST_UNIT_EPOCH,
        });
        yield* db.insert(inventoryChanges).values([
          {
            organizationId,
            commitSequence: "4",
            ordinal: 0,
            entity: "invoice",
            action: "upsert",
            entityId: "invoice-late",
            rowVersion: 1,
            rowJson: JSON.stringify({ id: "invoice-late", rowVersion: 1 }),
          },
          {
            organizationId,
            commitSequence: "4",
            ordinal: 1,
            entity: "stockMovement",
            action: "upsert",
            entityId: "movement-late",
            rowVersion: 1,
            rowJson: JSON.stringify({ id: "movement-late", rowVersion: 1 }),
          },
          {
            organizationId,
            commitSequence: "4",
            ordinal: 2,
            entity: "category",
            action: "upsert",
            entityId: "category-late",
            rowVersion: 1,
            rowJson: JSON.stringify({ id: "category-late", rowVersion: 1 }),
          },
        ]);
        yield* db
          .update(inventoryState)
          .set({ commitSequence: "4" })
          .where(eq(inventoryState.organizationId, organizationId));
        for (let index = 0; index < 20; index += 1) {
          const progress = yield* stepSnapshotJobs(db)(organizationId);
          if (progress.stage === "published" || progress.snapshotId === null) break;
        }
        const job = yield* readJob(db, organizationId, snapshotId);
        const parts = yield* db
          .select({ payloadJson: snapshotParts.payloadJson })
          .from(snapshotParts)
          .where(
            and(
              eq(snapshotParts.organizationId, organizationId),
              eq(snapshotParts.snapshotId, snapshotId),
            ),
          );
        const rows = parts.flatMap((part) =>
          Schema.decodeUnknownSync(StagedPartRows)(JSON.parse(part.payloadJson)).rows.map(
            (row) => `${row.entity}:${row.entityId}`,
          ),
        );
        return { job, rows };
      }),
    );
    expect(outcome.job?.stage).toBe("published");
    expect(outcome.job?.horizon).toBe("4");
    expect(outcome.rows.sort((left, right) => left.localeCompare(right))).toEqual([
      `batch:${LAST_UNIT_BATCH_ID}`,
      "category:category-late",
      "category:general",
      `product:${LAST_UNIT_PRODUCT_ID}`,
    ]);
  }, 60_000);

  it("fails only snapshot jobs whose owner lease expired long ago", async () => {
    const organizationId = decodeOrganizationId("org-snapshot-abandoned");
    const now = OCCURRED_AT + 10 * 60 * 60_000;
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        const job = (snapshotId: string, ownerToken: string | null, stepDueAt: number) => ({
          organizationId,
          snapshotId,
          subscription: OPERATIONAL_SUBSCRIPTION,
          stage: "copying" as const,
          fence: 1,
          ownerToken,
          startedAtCommitSequence: "3",
          horizon: null,
          copyEntity: "category",
          copyCursor: null,
          stepDueAt,
        });
        yield* db
          .insert(snapshotJobs)
          .values([
            job("snapshot-waiting", null, OCCURRED_AT),
            job("snapshot-owned-recent", "owner-recent", now - 1_000),
            job("snapshot-owned-expired", "owner-expired", OCCURRED_AT),
          ]);
        yield* runRetentionStep(db, TEST_POLICY)(organizationId, now);
        return yield* db
          .select({ snapshotId: snapshotJobs.snapshotId, stage: snapshotJobs.stage })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId))
          .orderBy(asc(snapshotJobs.snapshotId));
      }),
    );
    expect(outcome).toEqual([
      { snapshotId: "snapshot-owned-expired", stage: "failed" },
      { snapshotId: "snapshot-owned-recent", stage: "copying" },
      { snapshotId: "snapshot-waiting", stage: "copying" },
    ]);
  });

  it("advances a snapshot job several steps within one scheduled run", async () => {
    const organizationId = decodeOrganizationId("org-snapshot-multi-step");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        yield* db
          .update(inventoryState)
          .set({ maintainedAt: Number.MAX_SAFE_INTEGER })
          .where(ne(inventoryState.organizationId, organizationId));
        const maintenance = makeInventoryMaintenance(db, TEST_REFRESH, 1);
        const progress = yield* maintenance.runScheduled(20_000);
        const jobs = yield* db
          .select({ stage: snapshotJobs.stage })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId));
        return { progress, jobs };
      }),
    );
    expect(outcome.progress.enqueuedSnapshots).toBe(1);
    expect(outcome.progress.snapshots.length).toBeGreaterThan(1);
    expect(outcome.jobs).toEqual([{ stage: "published" }]);
  }, 120_000);

  it("runs a scheduled maintenance pass within a time budget and reports more", async () => {
    const organizationId = decodeOrganizationId("org-scheduled");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        const maintenance = makeInventoryMaintenance(db);
        const exhausted = yield* maintenance.runScheduled(0);
        const worked = yield* maintenance.runScheduled(20_000);
        return { exhausted, worked };
      }),
    );
    expect(outcome.exhausted.organizations).toBe(0);
    expect(outcome.exhausted.more).toBe(true);
    expect(outcome.worked.organizations).toBeGreaterThan(0);
    expect(outcome.worked.retention.length).toBeGreaterThan(0);
  }, 120_000);

  it("enqueues a snapshot job through the scheduled run when no snapshot exists", async () => {
    const organizationId = decodeOrganizationId("org-auto-enqueue");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 5);
        const maintenance = makeInventoryMaintenance(db, TEST_REFRESH);
        const progress = yield* maintenance.runScheduled(20_000);
        const jobs = yield* db
          .select({ snapshotId: snapshotJobs.snapshotId, stage: snapshotJobs.stage })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId));
        return { progress, jobs };
      }),
    );
    expect(outcome.progress.enqueuedSnapshots).toBeGreaterThan(0);
    expect(outcome.jobs).toHaveLength(1);
  }, 120_000);

  it("enqueues only when the newest published snapshot is more than the lag behind head", async () => {
    const organizationId = decodeOrganizationId("org-lag-enqueue");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshotJob(db, organizationId, "snapshot-lag", "9");
        const fresh = yield* ensureSnapshotJob(db, TEST_REFRESH)(organizationId);
        yield* db
          .update(inventoryState)
          .set({ commitSequence: "20" })
          .where(eq(inventoryState.organizationId, organizationId));
        const stale = yield* ensureSnapshotJob(db, TEST_REFRESH)(organizationId);
        const whileActive = yield* ensureSnapshotJob(db, TEST_REFRESH)(organizationId);
        return { fresh, stale, whileActive };
      }),
    );
    expect(outcome.fresh).toBeUndefined();
    expect(outcome.stale).toBeDefined();
    expect(outcome.whileActive).toBeUndefined();
  });

  it("advances the retention floor once the enqueued job publishes", async () => {
    const organizationId = decodeOrganizationId("org-enqueue-floor");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        const enqueued = yield* ensureSnapshotJob(db, TEST_REFRESH)(organizationId);
        const beforePublish = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        for (let index = 0; index < 20; index += 1) {
          const progress = yield* stepSnapshotJobs(db)(organizationId);
          if (progress.stage === "published" || progress.snapshotId === null) break;
        }
        const afterPublish = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        return { enqueued, beforePublish, afterPublish };
      }),
    );
    expect(outcome.enqueued).toBeDefined();
    expect(outcome.beforePublish.floorAfter).toBe("0");
    expect(outcome.afterPublish.floorAfter).toBe("1");
  }, 60_000);

  it("returns the stale published snapshot while a job is mid-flight without building synchronously", async () => {
    const organizationId = decodeOrganizationId("org-stale-acquire");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshotJob(db, organizationId, "snapshot-stale", "1");
        yield* enqueueSnapshotJob(db)(organizationId);
        const snapshots = makeInventorySnapshots(db, TEST_REFRESH);
        const acquired = yield* snapshots.acquireSnapshot(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        const jobs = yield* db
          .select({ snapshotId: snapshotJobs.snapshotId })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId));
        return { acquired, jobs };
      }),
    );
    expect(outcome.acquired._tag).toBe("ready");
    if (outcome.acquired._tag !== "ready") return;
    expect(outcome.acquired.manifest.snapshotId).toBe("snapshot-stale");
    expect(outcome.jobs).toHaveLength(2);
  });

  it("prunes superseded snapshots and keeps the one a download lease pins", async () => {
    const organizationId = decodeOrganizationId("org-snapshot-prune");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        for (const horizon of ["1", "2", "3", "4"]) {
          yield* publishSnapshotJob(db, organizationId, `snapshot-${horizon}`, horizon);
          yield* db.insert(snapshotParts).values({
            organizationId,
            snapshotId: `snapshot-${horizon}`,
            partNumber: 1,
            objectKey: `${organizationId}/snapshot-${horizon}/1`,
            byteLength: 2,
            sha256: "0".repeat(64),
            payloadJson: "[]",
          });
        }
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_A,
          "snapshot-1",
          "1",
          OCCURRED_AT + 600_000,
        );
        const progress = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const remaining = yield* db
          .select({ snapshotId: snapshotJobs.snapshotId })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId))
          .orderBy(asc(snapshotJobs.snapshotId));
        const parts = yield* db
          .select({ snapshotId: snapshotParts.snapshotId })
          .from(snapshotParts)
          .where(eq(snapshotParts.organizationId, organizationId))
          .orderBy(asc(snapshotParts.snapshotId));
        return { progress, remaining, parts };
      }),
    );
    expect(outcome.progress.prunedSnapshots).toBe(1);
    expect(outcome.remaining.map((row) => row.snapshotId)).toEqual([
      "snapshot-1",
      "snapshot-3",
      "snapshot-4",
    ]);
    expect(outcome.parts.map((row) => row.snapshotId)).toEqual([
      "snapshot-1",
      "snapshot-3",
      "snapshot-4",
    ]);
  });

  it("deletes expired consumed tickets in bounded batches and keeps live ones", async () => {
    const organizationId = decodeOrganizationId("org-ticket-expiry");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 3);
        yield* db.insert(consumedTickets).values([
          { organizationId, nonceHash: "expired-1", expiresAt: OCCURRED_AT - 3 },
          { organizationId, nonceHash: "expired-2", expiresAt: OCCURRED_AT - 2 },
          { organizationId, nonceHash: "expired-3", expiresAt: OCCURRED_AT - 1 },
          { organizationId, nonceHash: "live", expiresAt: OCCURRED_AT + 60_000 },
        ]);
        const first = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const second = yield* runRetentionStep(db, TEST_POLICY)(organizationId, OCCURRED_AT);
        const remaining = yield* db
          .select({ nonceHash: consumedTickets.nonceHash })
          .from(consumedTickets)
          .where(eq(consumedTickets.organizationId, organizationId));
        return { first, second, remaining };
      }),
    );
    expect(outcome.first.expiredTickets).toBe(2);
    expect(outcome.second.expiredTickets).toBe(1);
    expect(outcome.remaining).toEqual([{ nonceHash: "live" }]);
  });

  it("serves the least recently maintained organization first on each scheduled run", async () => {
    const stale = decodeOrganizationId("org-fair-never");
    const recent = decodeOrganizationId("org-fair-recent");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(stale, 2);
        yield* seedOrganization(recent, 2);
        yield* db
          .update(inventoryState)
          .set({ maintainedAt: Number.MAX_SAFE_INTEGER })
          .where(ne(inventoryState.organizationId, stale));
        yield* db
          .update(inventoryState)
          .set({ maintainedAt: 1 })
          .where(eq(inventoryState.organizationId, recent));
        const maintenance = makeInventoryMaintenance(db, TEST_REFRESH, 1);
        const first = yield* maintenance.runScheduled(20_000);
        const second = yield* maintenance.runScheduled(20_000);
        const stamps = yield* db
          .select({
            organizationId: inventoryState.organizationId,
            maintainedAt: inventoryState.maintainedAt,
          })
          .from(inventoryState)
          .where(inArray(inventoryState.organizationId, [stale, recent]));
        return { first, second, stamps };
      }),
    );
    expect(outcome.first.retention.map((step) => step.organizationId)).toEqual([stale]);
    expect(outcome.second.retention.map((step) => step.organizationId)).toEqual([recent]);
    for (const stamp of outcome.stamps) {
      expect(stamp.maintainedAt).toBeGreaterThan(1);
      expect(stamp.maintainedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  }, 120_000);
});
