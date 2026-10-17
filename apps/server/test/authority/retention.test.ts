import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence, SyncProtocolError } from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import {
  authorityChanges,
  authorityState,
  authorityTransactions,
  batches,
  categories,
  commandReceipts,
  downloadLeases,
  importParts,
  products,
  replicas,
  snapshots,
} from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import { asc } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { makeAuthorityEngine } from "../../src/authority/engine";
import { makeAuthorityMaintenance, type MaintenancePolicy } from "../../src/authority/maintenance";
import { MAINTENANCE_POLICY } from "../../src/authority/policy";
import { makeAuthoritySnapshots } from "../../src/authority/snapshots";
import { makeInventoryCommands } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";
import { typedCommands } from "../inventory/typed-commands";
import { makeTestAuthorities, type TestAuthorities } from "./harness";

const isProtocol = Schema.is(SyncProtocolError);

const OCCURRED_AT = 1_700_000_000_000;

const TEST_POLICY: MaintenancePolicy = {
  ...MAINTENANCE_POLICY,
  budgetMillis: 20_000,
  minimumRetainedTransactions: 2,
  deleteBatchTransactions: 2,
  deleteBatchesPerStep: 2,
  expiredLeaseBatchRows: 50,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
};

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(OCCURRED_AT);
      return yield* effect;
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

const actorFor = (organizationId: string): InventoryActor => ({
  organizationId,
  userId: "user-1",
});

const seedOrganization = (authorities: TestAuthorities, organizationId: string, head: number) =>
  Effect.gen(function* () {
    const { db, sql } = yield* authorities.open(organizationId);
    const metadata = {
      organizationId,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: LAST_UNIT_REPLICA_A,
      rowVersion: 1,
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
    };
    yield* Effect.gen(function* () {
      yield* db.insert(authorityState).values({
        id: 1,
        organizationId,
        incarnation: "incarnation-test",
        epoch: LAST_UNIT_EPOCH,
        commitSequence: head,
        retentionFloor: 0,
        createdAt: OCCURRED_AT,
      });
      yield* db.insert(replicas).values({
        replicaId: LAST_UNIT_REPLICA_A,
        ownerUserId: "user-1",
        deviceLabel: LAST_UNIT_REPLICA_A,
        lastClientSequence: head,
        processedThroughClientSequence: head,
        registeredAt: OCCURRED_AT,
        lastSeenAt: OCCURRED_AT,
      });
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
        unitsPerPack: 1,
        purchasePrice: 50,
        retailPrice: 100,
        unitPrice: 100,
        visible: true,
        operationId: "seed-product",
        ...metadata,
      });
      yield* db.insert(batches).values({
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        packQuantity: 0,
        unitQuantity: 10,
        operationId: "seed-batch",
        ...metadata,
      });
      for (let sequence = 1; sequence <= head; sequence += 1) {
        yield* db.insert(authorityTransactions).values({
          commitSequence: sequence,
          operationId: `op-${sequence}`,
          decision: "accepted",
          epoch: LAST_UNIT_EPOCH,
          byteLength: 256,
        });
        yield* db.insert(authorityChanges).values({
          commitSequence: sequence,
          ordinal: 0,
          entity: "product",
          action: "upsert",
          entityId: LAST_UNIT_PRODUCT_ID,
          rowVersion: sequence,
          rowJson: JSON.stringify({ id: LAST_UNIT_PRODUCT_ID, rowVersion: sequence }),
        });
        yield* db.insert(commandReceipts).values({
          operationId: `op-${sequence}`,
          replicaId: LAST_UNIT_REPLICA_A,
          clientSequence: sequence,
          payloadHash: `hash-${sequence}`,
          decision: "accepted",
          commitSequence: sequence,
          resultJson: JSON.stringify({ _tag: "accepted" }),
          receivedAt: OCCURRED_AT,
          attempts: 1,
        });
      }
    }).pipe(Effect.orDie);
    const engine = makeAuthorityEngine(sql, db);
    let minted = 0;
    const built = makeAuthoritySnapshots(
      engine,
      db,
      Effect.sync(() => `built${(minted += 1)}`),
    );
    const maintenance = makeAuthorityMaintenance(engine, db, built);
    return {
      db,
      maintain: (policy: Partial<MaintenancePolicy> = {}) =>
        maintenance.run(OCCURRED_AT, { ...TEST_POLICY, ...policy }).pipe(Effect.orDie),
    };
  });

const publishSnapshot = (
  db: ReplicaDb,
  snapshotId: string,
  horizon: number,
  publishedAt = OCCURRED_AT,
) =>
  db
    .insert(snapshots)
    .values({
      snapshotId,
      subscription: OPERATIONAL_SUBSCRIPTION,
      horizon,
      entityCountsJson: "{}",
      publishedAt,
    })
    .pipe(Effect.orDie);

const grantLease = (
  db: ReplicaDb,
  replicaId: string,
  snapshotId: string,
  pinnedHorizon: number,
  expiresAt: number,
) =>
  db
    .insert(downloadLeases)
    .values({ replicaId, snapshotId, pinnedHorizon, expiresAt })
    .pipe(Effect.orDie);

const readFloor = (db: ReplicaDb) =>
  db
    .select({ retentionFloor: authorityState.retentionFloor })
    .from(authorityState)
    .get()
    .pipe(
      Effect.map((state) => state?.retentionFloor ?? null),
      Effect.orDie,
    );

describe("durable object inventory maintenance", () => {
  it("advances the floor to the smallest of snapshot horizon, lease cursor, and head minus the minimum", async () => {
    const organizationId = decodeOrganizationId("org-floor-min");
    const outcome = await run(
      Effect.gen(function* () {
        const { db, maintain } = yield* seedOrganization(makeTestAuthorities(), organizationId, 10);
        yield* publishSnapshot(db, "snapshot-min", 6);
        yield* grantLease(db, LAST_UNIT_REPLICA_A, "snapshot-min", 4, OCCURRED_AT + 600_000);
        const withLease = yield* maintain();
        yield* db.delete(downloadLeases).pipe(Effect.orDie);
        const withoutLease = yield* maintain();
        return { withLease, withoutLease, floor: yield* readFloor(db) };
      }),
    );
    expect(outcome.withLease.floorBefore).toBe("0");
    expect(outcome.withLease.floorAfter).toBe("4");
    expect(outcome.withLease.builtSnapshot).toBe(false);
    expect(outcome.withoutLease.floorAfter).toBe("6");
    expect(outcome.floor).toBe(6);
  });

  it("never regresses the retention floor", async () => {
    const organizationId = decodeOrganizationId("org-floor-monotonic");
    const outcome = await run(
      Effect.gen(function* () {
        const { db, maintain } = yield* seedOrganization(makeTestAuthorities(), organizationId, 10);
        yield* publishSnapshot(db, "snapshot-monotonic", 6);
        const first = yield* maintain();
        yield* grantLease(db, LAST_UNIT_REPLICA_A, "snapshot-monotonic", 1, OCCURRED_AT + 600_000);
        const second = yield* maintain();
        return { first, second, floor: yield* readFloor(db) };
      }),
    );
    expect(outcome.first.floorAfter).toBe("6");
    expect(outcome.second.floorBefore).toBe("6");
    expect(outcome.second.floorAfter).toBe("6");
    expect(outcome.floor).toBe(6);
  });

  it("deletes history below the floor in bounded batches and keeps command receipts", async () => {
    const organizationId = decodeOrganizationId("org-bounded-delete");
    const outcome = await run(
      Effect.gen(function* () {
        const { db, maintain } = yield* seedOrganization(makeTestAuthorities(), organizationId, 10);
        yield* publishSnapshot(db, "snapshot-bounded", 10);
        const first = yield* maintain();
        const second = yield* maintain();
        const third = yield* maintain();
        const remainingTransactions = yield* db
          .select({ commitSequence: authorityTransactions.commitSequence })
          .from(authorityTransactions)
          .orderBy(asc(authorityTransactions.commitSequence))
          .all()
          .pipe(Effect.orDie);
        const remainingChanges = yield* db.select().from(authorityChanges).all().pipe(Effect.orDie);
        const receipts = yield* db
          .select({ operationId: commandReceipts.operationId })
          .from(commandReceipts)
          .all()
          .pipe(Effect.orDie);
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
    expect(outcome.remainingTransactions.map((row) => row.commitSequence)).toEqual([9, 10]);
    expect(outcome.remainingChanges).toHaveLength(2);
    expect(outcome.receipts).toHaveLength(10);
  });

  it("expires leases, prunes old unleased snapshots, and sweeps abandoned import parts", async () => {
    const organizationId = decodeOrganizationId("org-prune");
    const outcome = await run(
      Effect.gen(function* () {
        const { db, maintain } = yield* seedOrganization(makeTestAuthorities(), organizationId, 10);
        yield* publishSnapshot(db, "snapshot-a", 2);
        yield* publishSnapshot(db, "snapshot-b", 4);
        yield* publishSnapshot(db, "snapshot-c", 6);
        yield* publishSnapshot(db, "snapshot-d", 8);
        yield* grantLease(db, LAST_UNIT_REPLICA_A, "snapshot-a", 2, OCCURRED_AT - 1);
        yield* grantLease(db, "replica-held", "snapshot-b", 4, OCCURRED_AT + 600_000);
        yield* db
          .insert(importParts)
          .values({
            importId: "abandoned",
            partNumber: 1,
            byteLength: 2,
            sha256: "0".repeat(64),
            framesJson: "[]",
            receivedAt: OCCURRED_AT - TEST_POLICY.abandonedImportMillis,
          })
          .pipe(Effect.orDie);
        const report = yield* maintain();
        const kept = yield* db
          .select({ snapshotId: snapshots.snapshotId })
          .from(snapshots)
          .orderBy(asc(snapshots.snapshotId))
          .all()
          .pipe(Effect.orDie);
        const leases = yield* db.select().from(downloadLeases).all().pipe(Effect.orDie);
        const parts = yield* db.select().from(importParts).all().pipe(Effect.orDie);
        return { report, kept, leases, parts };
      }),
    );
    expect(outcome.report.expiredLeases).toBe(1);
    expect(outcome.report.prunedSnapshots).toBe(1);
    expect(outcome.report.sweptImportParts).toBe(1);
    expect(outcome.kept.map((row) => row.snapshotId)).toEqual([
      "snapshot-b",
      "snapshot-c",
      "snapshot-d",
    ]);
    expect(outcome.leases.map((lease) => lease.replicaId)).toEqual(["replica-held"]);
    expect(outcome.parts).toHaveLength(0);
    expect(outcome.report.floorAfter).toBe("4");
  });

  it("refuses a pull below the new floor and serves a pull above it", async () => {
    const organizationId = decodeOrganizationId("org-pull-floor");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const authorities = makeTestAuthorities();
        const { db, maintain } = yield* seedOrganization(authorities, organizationId, 10);
        yield* publishSnapshot(db, "snapshot-pull", 6);
        const commands = typedCommands(makeInventoryCommands(authorities));
        const pullAfter = (after: string) =>
          commands.pull(actor, {
            epoch: LAST_UNIT_EPOCH,
            subscription: OPERATIONAL_SUBSCRIPTION,
            afterCommitSequence: OrgCommitSequence.make(after),
          });
        const beforeRetention = yield* pullAfter("0");
        const progress = yield* maintain();
        const belowFloor = yield* pullAfter("0").pipe(Effect.flip);
        const atFloor = yield* pullAfter("6");
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
});
