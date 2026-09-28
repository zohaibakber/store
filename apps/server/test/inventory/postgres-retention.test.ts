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
  downloadLeases,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  products,
  replicas,
  snapshotJobs,
  snapshotParts,
} from "@store/db/postgres/schema";
import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import {
  MAINTENANCE_POLICY,
  makeInventoryMaintenance,
  type MaintenancePolicy,
  type MaintenanceSummary,
} from "../../src/inventory/maintenance";
import type { InventoryActor } from "../../src/inventory/model";
import type { InventoryDrizzle } from "../../src/inventory/postgres";
import { countStatements } from "../lib/statement-count";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);

let database: AuthorityPostgres;

const OCCURRED_AT = 1_700_000_000_000;

const TEST_POLICY: MaintenancePolicy = {
  ...MAINTENANCE_POLICY,
  budgetMillis: 20_000,
  organizationsPerRun: 1_000,
  minimumRetainedTransactions: 2,
  deleteBatchTransactions: 2,
  deleteBatchesPerStep: 2,
  expiredLeaseBatchRows: 50,
  expiredTicketBatchRows: 2,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
};

const layer = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-retention-tests",
  });

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(OCCURRED_AT);
      return yield* effect;
    }).pipe(Effect.provide(TestClock.layer()), Effect.provide(layer()), Effect.scoped),
  );

const actorFor = (organizationId: string): InventoryActor => ({
  organizationId,
  userId: "user-1",
});

const openDrizzle = Effect.gen(function* () {
  const client = yield* PgClient.PgClient;
  return yield* PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));
});

const maintain = (db: InventoryDrizzle, policy: Partial<MaintenancePolicy> = {}) =>
  makeInventoryMaintenance(db, TEST_POLICY).runScheduled(policy);

const reportFor = (summary: MaintenanceSummary, organizationId: string) => {
  const report = summary.retention.find((entry) => entry.organizationId === organizationId);
  if (report === undefined) throw new Error(`no maintenance report for ${organizationId}`);
  return report;
};

const maintainOrganization = (
  db: InventoryDrizzle,
  organizationId: string,
  policy: Partial<MaintenancePolicy> = {},
) => maintain(db, policy).pipe(Effect.map((summary) => reportFor(summary, organizationId)));

const seedCatalog = (db: InventoryDrizzle, organizationId: string) =>
  Effect.gen(function* () {
    const metadata = {
      organizationId,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: LAST_UNIT_REPLICA_A,
      rowVersion: 1,
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
    };
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      operationId: "seed-category",
      ...metadata,
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
      deletedAt: null,
      operationId: "seed-product",
      ...metadata,
    });
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 10,
      deletedAt: null,
      operationId: "seed-batch",
      ...metadata,
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
        byteLength: 256,
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

const publishSnapshot = (
  db: InventoryDrizzle,
  organizationId: string,
  snapshotId: string,
  horizon: string,
  publishedAt = OCCURRED_AT,
) =>
  db.insert(snapshotJobs).values({
    organizationId,
    snapshotId,
    subscription: OPERATIONAL_SUBSCRIPTION,
    horizon,
    entityCountsJson: "{}",
    publishedAt,
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

const readSnapshots = (db: InventoryDrizzle, organizationId: string) =>
  db
    .select({ snapshotId: snapshotJobs.snapshotId, horizon: snapshotJobs.horizon })
    .from(snapshotJobs)
    .where(eq(snapshotJobs.organizationId, organizationId))
    .orderBy(desc(snapshotJobs.horizon));

describe("postgres inventory maintenance", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("runs every organization's maintenance in one statement", async () => {
    const organizationId = decodeOrganizationId("org-maintain-one-statement");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 4);
        return yield* countStatements(maintain(db));
      }),
    );
    expect(outcome.roundTrips).toBe(1);
    expect(outcome.statements).toBe(1);
    expect(outcome.result.failures).toEqual([]);
    expect(reportFor(outcome.result, organizationId).builtSnapshot).toBe(true);
  });

  it("advances the floor to the smallest of snapshot horizon, lease cursor, and head minus the minimum", async () => {
    const organizationId = decodeOrganizationId("org-floor-min");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshot(db, organizationId, "snapshot-min", "6");
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_A,
          "snapshot-min",
          "4",
          OCCURRED_AT + 600_000,
        );
        const withLease = yield* maintainOrganization(db, organizationId);
        yield* db.delete(downloadLeases).where(eq(downloadLeases.organizationId, organizationId));
        const withoutLease = yield* maintainOrganization(db, organizationId);
        return { withLease, withoutLease, floor: yield* readFloor(db, organizationId) };
      }),
    );
    expect(outcome.withLease.floorBefore).toBe("0");
    expect(outcome.withLease.floorAfter).toBe("4");
    expect(outcome.withLease.builtSnapshot).toBe(false);
    expect(outcome.withoutLease.floorAfter).toBe("6");
    expect(outcome.floor).toBe("6");
  });

  it("never regresses the retention floor", async () => {
    const organizationId = decodeOrganizationId("org-floor-monotonic");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshot(db, organizationId, "snapshot-monotonic", "6");
        const first = yield* maintainOrganization(db, organizationId);
        yield* grantLease(
          db,
          organizationId,
          LAST_UNIT_REPLICA_A,
          "snapshot-monotonic",
          "1",
          OCCURRED_AT + 600_000,
        );
        const second = yield* maintainOrganization(db, organizationId);
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
        yield* publishSnapshot(db, organizationId, "snapshot-bounded", "10");
        const first = yield* maintainOrganization(db, organizationId);
        const second = yield* maintainOrganization(db, organizationId);
        const third = yield* maintainOrganization(db, organizationId);
        const remainingTransactions = yield* db
          .select({ commitSequence: inventoryTransactions.commitSequence })
          .from(inventoryTransactions)
          .where(eq(inventoryTransactions.organizationId, organizationId))
          .orderBy(asc(inventoryTransactions.commitSequence));
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
        yield* publishSnapshot(db, organizationId, "snapshot-pull", "6");
        const commands = makeInventoryCommands(db);
        const beforeRetention = yield* commands.pull(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
          afterCommitSequence: OrgCommitSequence.make("0"),
        });
        const progress = yield* maintainOrganization(db, organizationId);
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
        yield* publishSnapshot(db, organizationId, "snapshot-lease", "2");
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
        const report = yield* maintainOrganization(db, organizationId);
        const leases = yield* db
          .select({ replicaId: downloadLeases.replicaId })
          .from(downloadLeases)
          .where(eq(downloadLeases.organizationId, organizationId))
          .orderBy(asc(downloadLeases.replicaId));
        return { report, leases };
      }),
    );
    expect(outcome.report.expiredLeases).toBe(1);
    expect(outcome.leases.map((row) => row.replicaId)).toEqual([LAST_UNIT_REPLICA_B]);
  });

  it("prunes superseded snapshots and keeps the one a download lease pins", async () => {
    const organizationId = decodeOrganizationId("org-snapshot-prune");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        for (const horizon of ["7", "8", "9", "10"]) {
          yield* publishSnapshot(db, organizationId, `snapshot-${horizon}`, horizon);
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
          "snapshot-7",
          "7",
          OCCURRED_AT + 600_000,
        );
        const report = yield* maintainOrganization(db, organizationId);
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
        return { report, remaining, parts };
      }),
    );
    expect(outcome.report.prunedSnapshots).toBe(1);
    expect(outcome.remaining.map((row) => row.snapshotId)).toEqual([
      "snapshot-10",
      "snapshot-7",
      "snapshot-9",
    ]);
    expect(outcome.parts.map((row) => row.snapshotId)).toEqual([
      "snapshot-10",
      "snapshot-7",
      "snapshot-9",
    ]);
  });

  it("maintains an organization once the consumed tickets table is dropped", async () => {
    const organizationId = decodeOrganizationId("org-ticket-expiry");
    const outcome = await run(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const db = yield* seedOrganization(organizationId, 3);
        const [table] = yield* sql<{
          readonly found: string | null;
        }>`select to_regclass('public.consumed_tickets')::text as found`;
        const report = yield* maintainOrganization(db, organizationId);
        return { found: table?.found, report };
      }),
    );
    expect(outcome.found).toBeNull();
    expect(outcome.report.expiredTickets).toBe(0);
    expect(outcome.report.builtSnapshot).toBe(true);
  });

  it("builds a snapshot for an organization without one and then advances the floor", async () => {
    const organizationId = decodeOrganizationId("org-maintain-builds");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 6);
        const report = yield* maintainOrganization(db, organizationId);
        const snapshots = yield* readSnapshots(db, organizationId);
        const again = yield* maintainOrganization(db, organizationId);
        return { report, snapshots, again };
      }),
    );
    expect(outcome.report.builtSnapshot).toBe(true);
    expect(outcome.snapshots.map((row) => row.horizon)).toEqual(["6"]);
    expect(outcome.report.floorAfter).toBe("4");
    expect(outcome.again.builtSnapshot).toBe(false);
  });

  it("rebuilds only when the newest snapshot lags head and the rebuild interval has passed", async () => {
    const organizationId = decodeOrganizationId("org-maintain-rebuild");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 10);
        yield* publishSnapshot(db, organizationId, "snapshot-old", "2");
        const recent = yield* maintainOrganization(db, organizationId, {
          lagTransactions: 2,
          minimumRebuildMillis: 60_000,
        });
        yield* TestClock.adjust("2 minutes");
        const due = yield* maintainOrganization(db, organizationId, {
          lagTransactions: 2,
          minimumRebuildMillis: 60_000,
        });
        return { recent, due, snapshots: yield* readSnapshots(db, organizationId) };
      }),
    );
    expect(outcome.recent.builtSnapshot).toBe(false);
    expect(outcome.due.builtSnapshot).toBe(true);
    expect(outcome.snapshots.map((row) => row.horizon)).toEqual(["10", "2"]);
  });

  it("stops at the time budget and reports more", async () => {
    const organizationId = decodeOrganizationId("org-maintain-budget");
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* seedOrganization(organizationId, 2);
        return yield* maintain(db, { budgetMillis: 0 });
      }),
    );
    expect(outcome.organizations).toBe(0);
    expect(outcome.more).toBe(true);
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
        const first = yield* maintain(db, { organizationsPerRun: 1 });
        const second = yield* maintain(db, { organizationsPerRun: 1 });
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
    expect(outcome.first.more).toBe(true);
    expect(outcome.second.retention.map((step) => step.organizationId)).toEqual([recent]);
    for (const stamp of outcome.stamps) {
      expect(stamp.maintainedAt).toBe(OCCURRED_AT);
    }
  }, 120_000);
  it("stamps each organization on its own so one lock timeout does not roll back the others", async () => {
    const locked = decodeOrganizationId("org-maintain-locked");
    const free = decodeOrganizationId("org-maintain-free");
    await run(
      Effect.gen(function* () {
        yield* seedOrganization(locked, 6);
        yield* seedOrganization(free, 6);
      }),
    );
    const holder = new pg.Client({ connectionString: database.connectionString });
    await holder.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from inventory_state where organization_id = $1 for update", [
        locked,
      ]);
      const outcome = await run(
        Effect.gen(function* () {
          const db = yield* openDrizzle;
          const summary = yield* maintain(db);
          const floors = yield* db
            .select({
              organizationId: inventoryState.organizationId,
              floor: inventoryState.retentionFloor,
              maintainedAt: inventoryState.maintainedAt,
            })
            .from(inventoryState)
            .where(inArray(inventoryState.organizationId, [locked, free]))
            .orderBy(asc(inventoryState.organizationId));
          return { summary, floors };
        }),
      );
      expect(outcome.summary.failures.map((failure) => failure.organizationId)).toEqual([locked]);
      expect(reportFor(outcome.summary, free).floorAfter).toBe("4");
      expect(outcome.floors).toEqual([
        { organizationId: free, floor: "4", maintainedAt: OCCURRED_AT },
        { organizationId: locked, floor: "0", maintainedAt: null },
      ]);
    } finally {
      await holder.query("rollback");
      await holder.end();
    }
  }, 30_000);

  it("gives up acquiring a snapshot while another transaction holds its build lock", async () => {
    const organizationId = decodeOrganizationId("org-acquire-lock-timeout");
    await run(seedOrganization(organizationId, 3));
    const holder = new pg.Client({ connectionString: database.connectionString });
    const caller = new pg.Client({ connectionString: database.connectionString });
    await holder.connect();
    await caller.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `sync.snapshot:${organizationId}`,
      ]);
      const started = performance.now();
      const [outcome] = await Promise.allSettled([
        caller.query(
          "select sync.acquire_snapshot($1, null, 'user-1', $2, 'operational', 1, 500, 60000)",
          [organizationId, LAST_UNIT_EPOCH],
        ),
      ]);
      const waited = performance.now() - started;
      expect(outcome).toMatchObject({ status: "rejected", reason: { code: "55P03" } });
      expect(waited).toBeLessThan(10_000);
    } finally {
      await holder.query("rollback");
      await holder.end();
      await caller.end();
    }
  }, 30_000);
});
