import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartPayload,
  SyncEpoch,
  SyncProtocolError,
} from "@store/contracts";
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
  downloadLeases,
  inventoryState,
  products,
  replicas,
  snapshotJobs,
} from "@store/db/postgres/schema";
import { eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIVE_HORIZON_SHARING, makeInventoryLive } from "../../src/inventory/live-tickets";
import type { InventoryActor } from "../../src/inventory/model";
import type { InventoryDrizzle } from "../../src/inventory/postgres";
import {
  makeInventorySnapshots,
  stepSnapshotJobs,
  type InventorySnapshotsContract,
} from "../../src/inventory/snapshots";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);

let database: AuthorityPostgres;

const layer = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-snapshot-live-tests",
  });

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer()), Effect.scoped));

const actorFor = (organizationId: string, userId = "user-1"): InventoryActor => ({
  organizationId,
  userId,
});

const openAuthority = (organizationId: string) =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
    const occurredAt = 1_700_000_000_000;
    const userId = "user-1";
    yield* db.insert(inventoryState).values({
      organizationId,
      status: "ready",
      importId: "import-test",
      releaseId: "release-test",
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: "2",
      retentionFloor: "0",
    });
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
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
      createdAt: occurredAt,
      updatedAt: occurredAt,
      deletedAt: null,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
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
      createdAt: occurredAt,
      updatedAt: occurredAt,
      deletedAt: null,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-batch",
      rowVersion: 1,
    });
    yield* db.insert(replicas).values({
      organizationId,
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: userId,
      deviceLabel: LAST_UNIT_REPLICA_A,
      lastClientSequence: "0",
      processedThroughClientSequence: "0",
      registeredAt: occurredAt,
      lastSeenAt: occurredAt,
    });
    return {
      snapshots: makeInventorySnapshots(db),
      live: makeInventoryLive(db),
      db,
    };
  });

const operationalRequest = {
  epoch: LAST_UNIT_EPOCH,
  subscription: OPERATIONAL_SUBSCRIPTION,
};

const publishPendingSnapshot = (db: InventoryDrizzle, organizationId: string) =>
  Effect.gen(function* () {
    for (let step = 0; step < 64; step += 1) {
      const progress = yield* stepSnapshotJobs(db)(organizationId);
      if (progress.stage === "published") return;
    }
    return yield* Effect.fail(new Error("the snapshot job did not publish"));
  });

const acquireReady = (
  snapshots: InventorySnapshotsContract,
  db: InventoryDrizzle,
  actor: InventoryActor,
) =>
  Effect.gen(function* () {
    const building = yield* snapshots.acquireSnapshot(actor, operationalRequest);
    if (building._tag !== "building") {
      return yield* Effect.fail(new Error("expected the first acquire to enqueue a build"));
    }
    yield* publishPendingSnapshot(db, actor.organizationId);
    const acquired = yield* snapshots.acquireSnapshot(actor, operationalRequest);
    if (acquired._tag !== "ready") {
      return yield* Effect.fail(new Error("expected ready snapshot"));
    }
    return { building, acquired };
  });

describe("postgres snapshot publication and live tickets", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("builds a snapshot off the request path, then serves its manifest and parts", async () => {
    const organizationId = decodeOrganizationId("org-snap-ready");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const { building, acquired } = yield* acquireReady(snapshots, db, actor);
        const partNumber = acquired.manifest.parts[0]?.partNumber ?? 1;
        const part = yield* snapshots.readSnapshotPart(
          actor,
          acquired.manifest.snapshotId,
          partNumber,
        );
        const encoded = yield* snapshots.readSnapshotPartEncoded(
          actor,
          acquired.manifest.snapshotId,
          partNumber,
        );
        const again = yield* snapshots.acquireSnapshot(actor, operationalRequest);
        return { building, acquired, part, encoded, again };
      }),
    );
    expect(result.building.retryAfterMillis).toBeGreaterThan(0);
    expect(result.acquired.manifest.snapshotId).toBe(result.building.snapshotId);
    expect(result.acquired.manifest.horizon).toBe(OrgCommitSequence.make("2"));
    expect(result.acquired.manifest.parts.length).toBeGreaterThan(0);
    expect(result.acquired.manifest.entityCounts).toEqual([
      { entity: "category", rowCount: 1 },
      { entity: "product", rowCount: 1 },
      { entity: "batch", rowCount: 1 },
    ]);
    expect(result.part.rows.some((row) => row.entity === "batch")).toBe(true);
    expect(result.encoded.sha256).toBe(result.acquired.manifest.parts[0]?.sha256);
    expect(result.encoded.json).toBe(
      Schema.encodeSync(Schema.fromJsonString(SnapshotPartPayload))(result.part),
    );
    expect(result.again._tag).toBe("ready");
    if (result.again._tag === "ready") {
      expect(result.again.manifest.snapshotId).toBe(result.acquired.manifest.snapshotId);
    }
  });

  it("reports the entity counts frozen into the snapshot, not the live tables", async () => {
    const organizationId = decodeOrganizationId("org-snap-counts");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const { acquired } = yield* acquireReady(snapshots, db, actor);
        yield* db.insert(categories).values({
          id: "late-category",
          name: "Late",
          tracksPacks: true,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          organizationId,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "late-category",
          rowVersion: 1,
        });
        const again = yield* snapshots.acquireSnapshot(actor, operationalRequest);
        return { acquired, again };
      }),
    );
    if (result.again._tag !== "ready") throw new Error("expected ready snapshot");
    expect(result.again.manifest.entityCounts).toEqual(result.acquired.manifest.entityCounts);
  });

  it("recounts a published snapshot whose counts were never stored", async () => {
    const organizationId = decodeOrganizationId("org-snap-recount");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const { acquired } = yield* acquireReady(snapshots, db, actor);
        yield* db
          .update(snapshotJobs)
          .set({ entityCountsJson: null })
          .where(eq(snapshotJobs.organizationId, organizationId));
        const recounted = yield* snapshots.acquireSnapshot(actor, operationalRequest);
        const [stored] = yield* db
          .select({ entityCountsJson: snapshotJobs.entityCountsJson })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId));
        return { acquired, recounted, stored };
      }),
    );
    if (result.recounted._tag !== "ready") throw new Error("expected ready snapshot");
    expect(result.recounted.manifest.entityCounts).toEqual(result.acquired.manifest.entityCounts);
    expect(result.stored?.entityCountsJson).not.toBeNull();
  });

  it("rejects missing snapshot parts and wrong epoch", async () => {
    const organizationId = decodeOrganizationId("org-snap-fail");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const { acquired } = yield* acquireReady(snapshots, db, actor);
        const missingPart = yield* snapshots
          .readSnapshotPart(actor, acquired.manifest.snapshotId, 99)
          .pipe(Effect.flip);
        const wrongEpoch = yield* snapshots
          .acquireSnapshot(actor, {
            epoch: SyncEpoch.make("9"),
            subscription: OPERATIONAL_SUBSCRIPTION,
          })
          .pipe(Effect.flip);
        const unknownSnapshot = yield* snapshots
          .readSnapshotPart(actor, SnapshotId.make("missing-snapshot-idxx"), 1)
          .pipe(Effect.flip);
        return { missingPart, wrongEpoch, unknownSnapshot };
      }),
    );
    expect(isProtocol(outcome.missingPart) && outcome.missingPart.code).toBe(
      "SNAPSHOT_UNAVAILABLE",
    );
    expect(isProtocol(outcome.wrongEpoch) && outcome.wrongEpoch.code).toBe("EPOCH_MISMATCH");
    expect(isProtocol(outcome.unknownSnapshot) && outcome.unknownSnapshot.code).toBe(
      "SNAPSHOT_UNAVAILABLE",
    );
  });

  it("mints a live ticket for a registered replica and rejects unknown replicas", async () => {
    const organizationId = decodeOrganizationId("org-live-ticket");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { live } = yield* openAuthority(organizationId);
        const ticket = yield* live.mintLiveTicket(actor, {
          replicaId: LAST_UNIT_REPLICA_A,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        const unknown = yield* live
          .mintLiveTicket(actor, {
            replicaId: LAST_UNIT_REPLICA_B,
            subscription: OPERATIONAL_SUBSCRIPTION,
          })
          .pipe(Effect.flip);
        const otherUser = yield* live
          .mintLiveTicket(actorFor(organizationId, "user-2"), {
            replicaId: LAST_UNIT_REPLICA_A,
            subscription: OPERATIONAL_SUBSCRIPTION,
          })
          .pipe(Effect.flip);
        return { ticket, unknown, otherUser };
      }),
    );
    expect(outcome.ticket.organizationId).toBe(organizationId);
    expect(outcome.ticket.nonce).toMatch(/^[0-9a-f]{64}$/u);
    expect(outcome.ticket.expiresAt).toBeGreaterThan(Date.now() - 60_000);
    expect(isProtocol(outcome.unknown) && outcome.unknown.code).toBe("TICKET_INVALID");
    expect(isProtocol(outcome.otherUser) && outcome.otherUser.code).toBe("REPLICA_OWNED_BY_OTHER");
  });

  it("consumes a live ticket once so the nonce cannot be reused", async () => {
    const organizationId = decodeOrganizationId("org-live-consume");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { live } = yield* openAuthority(organizationId);
        const ticket = yield* live.mintLiveTicket(actor, {
          replicaId: LAST_UNIT_REPLICA_A,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        yield* live.consumeLiveTicket(actor, {
          nonce: ticket.nonce,
          replicaId: LAST_UNIT_REPLICA_A,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        const reused = yield* live
          .consumeLiveTicket(actor, {
            nonce: ticket.nonce,
            replicaId: LAST_UNIT_REPLICA_A,
            subscription: OPERATIONAL_SUBSCRIPTION,
          })
          .pipe(Effect.flip);
        const horizon = yield* live.readLiveHorizon(actor);
        return { reused, horizon };
      }),
    );
    expect(isProtocol(outcome.reused) && outcome.reused.code).toBe("TICKET_INVALID");
    expect(outcome.horizon.epoch).toBe(LAST_UNIT_EPOCH);
    expect(outcome.horizon.horizon).toMatch(/^[0-9]+$/u);
  });

  it("grants a download lease only for a replica the actor owns", async () => {
    const organizationId = decodeOrganizationId("org-snap-lease");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        yield* acquireReady(snapshots, db, actor);
        const withoutReplica = yield* snapshots.acquireSnapshot(actor, operationalRequest);
        const leasesBefore = yield* db
          .select()
          .from(downloadLeases)
          .where(eq(downloadLeases.organizationId, organizationId));
        const withReplica = yield* snapshots.acquireSnapshot(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
          replicaId: LAST_UNIT_REPLICA_A,
        });
        const leases = yield* db
          .select()
          .from(downloadLeases)
          .where(eq(downloadLeases.organizationId, organizationId));
        const foreign = yield* snapshots
          .acquireSnapshot(actorFor(organizationId, "user-2"), {
            epoch: LAST_UNIT_EPOCH,
            subscription: OPERATIONAL_SUBSCRIPTION,
            replicaId: LAST_UNIT_REPLICA_A,
          })
          .pipe(Effect.flip);
        const unknown = yield* snapshots
          .acquireSnapshot(actor, {
            epoch: LAST_UNIT_EPOCH,
            subscription: OPERATIONAL_SUBSCRIPTION,
            replicaId: LAST_UNIT_REPLICA_B,
          })
          .pipe(Effect.flip);
        return { withoutReplica, leasesBefore, withReplica, leases, foreign, unknown };
      }),
    );
    expect(outcome.withoutReplica._tag).toBe("ready");
    expect(outcome.leasesBefore).toHaveLength(0);
    if (outcome.withReplica._tag !== "ready") throw new Error("expected ready snapshot");
    expect(outcome.leases).toHaveLength(1);
    expect(outcome.leases[0]).toMatchObject({
      replicaId: LAST_UNIT_REPLICA_A,
      snapshotId: outcome.withReplica.manifest.snapshotId,
      pinnedHorizon: outcome.withReplica.manifest.horizon,
    });
    expect(isProtocol(outcome.foreign) && outcome.foreign.code).toBe("REPLICA_OWNED_BY_OTHER");
    expect(isProtocol(outcome.unknown) && outcome.unknown.code).toBe("REPLICA_UNKNOWN");
  });

  it("shares one organization's horizon across live readers for a bounded window", async () => {
    const organizationId = decodeOrganizationId("org-live-shared-horizon");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { live, db } = yield* openAuthority(organizationId);
        const first = yield* live.readLiveHorizon(actor);
        yield* db
          .update(inventoryState)
          .set({ commitSequence: "3" })
          .where(eq(inventoryState.organizationId, organizationId));
        const shared = yield* live.readLiveHorizon(actor);
        yield* TestClock.adjust(LIVE_HORIZON_SHARING.maxAgeMillis);
        const refreshed = yield* live.readLiveHorizon(actor);
        return { first, shared, refreshed };
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(outcome.first.horizon).toBe("2");
    expect(outcome.shared.horizon).toBe("2");
    expect(outcome.refreshed.horizon).toBe("3");
  });
});
