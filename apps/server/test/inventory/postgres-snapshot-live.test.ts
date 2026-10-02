import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  SyncEpoch,
  SyncProtocolError,
  type AcquireSnapshotRequest,
  type AcquireSnapshotResult,
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
  snapshotParts,
} from "@store/db/postgres/schema";
import { asc, eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryActor } from "../../src/inventory/model";
import type { InventoryDrizzle } from "../../src/inventory/postgres";
import { makeInventorySnapshots } from "../../src/inventory/snapshots";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);

let database: AuthorityPostgres;

const OCCURRED_AT = 1_700_000_000_000;

const layer = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-snapshot-tests",
  });

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer()), Effect.scoped));

const actorFor = (organizationId: string, userId = "user-1"): InventoryActor => ({
  organizationId,
  userId,
});

const metadata = (organizationId: string, operationId: string) => ({
  createdAt: OCCURRED_AT,
  updatedAt: OCCURRED_AT,
  organizationId,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: LAST_UNIT_REPLICA_A,
  operationId,
  rowVersion: 1,
});

const insertCategory = (db: InventoryDrizzle, organizationId: string, id: string) =>
  db.insert(categories).values({
    id,
    name: `Category ${id}`,
    tracksPacks: true,
    ...metadata(organizationId, `seed-${id}`),
  });

const openAuthority = (organizationId: string) =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
    yield* db.insert(inventoryState).values({
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: "2",
      retentionFloor: "0",
    });
    yield* insertCategory(db, organizationId, "general");
    yield* db.insert(products).values([
      {
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
        ...metadata(organizationId, "seed-product"),
      },
      {
        id: "retired-product",
        name: "Retired",
        categoryId: "general",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        purchasePrice: null,
        retailPrice: null,
        unitPrice: null,
        visible: false,
        deletedAt: OCCURRED_AT,
        ...metadata(organizationId, "seed-retired"),
      },
    ]);
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 10,
      deletedAt: null,
      ...metadata(organizationId, "seed-batch"),
    });
    yield* db.insert(replicas).values({
      organizationId,
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: "user-1",
      deviceLabel: LAST_UNIT_REPLICA_A,
      lastClientSequence: "0",
      processedThroughClientSequence: "0",
      registeredAt: OCCURRED_AT,
      lastSeenAt: OCCURRED_AT,
    });
    return { snapshots: makeInventorySnapshots(db), db };
  });

const operationalRequest: AcquireSnapshotRequest = {
  epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
  subscription: OPERATIONAL_SUBSCRIPTION,
};

const replicaRequest: AcquireSnapshotRequest = {
  ...operationalRequest,
  replicaId: LAST_UNIT_REPLICA_A,
};

const readyManifest = (result: AcquireSnapshotResult) => {
  if (result._tag !== "ready") throw new Error("expected a ready snapshot");
  return result.manifest;
};

describe("postgres snapshot acquisition", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("grants a download lease only for a replica the actor owns", async () => {
    const organizationId = decodeOrganizationId("org-snap-lease");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const withoutReplica = yield* snapshots.acquireSnapshot(actor, operationalRequest);
        const leasesBefore = yield* db
          .select()
          .from(downloadLeases)
          .where(eq(downloadLeases.organizationId, organizationId));
        const withReplica = yield* snapshots.acquireSnapshot(actor, replicaRequest);
        const leases = yield* db
          .select()
          .from(downloadLeases)
          .where(eq(downloadLeases.organizationId, organizationId));
        const foreign = yield* snapshots
          .acquireSnapshot(actorFor(organizationId, "user-2"), replicaRequest)
          .pipe(Effect.flip);
        const unknown = yield* snapshots
          .acquireSnapshot(actor, { ...operationalRequest, replicaId: LAST_UNIT_REPLICA_B })
          .pipe(Effect.flip);
        const parts = yield* db
          .select({ partNumber: snapshotParts.partNumber })
          .from(snapshotParts)
          .where(eq(snapshotParts.organizationId, organizationId))
          .orderBy(asc(snapshotParts.partNumber));
        return { withoutReplica, leasesBefore, withReplica, leases, foreign, unknown, parts };
      }),
    );
    expect(outcome.withoutReplica._tag).toBe("ready");
    expect(outcome.leasesBefore).toHaveLength(0);
    const manifest = readyManifest(outcome.withReplica);
    expect(outcome.leases).toHaveLength(1);
    expect(outcome.leases[0]).toMatchObject({
      replicaId: LAST_UNIT_REPLICA_A,
      snapshotId: manifest.snapshotId,
      pinnedHorizon: manifest.horizon,
    });
    expect(outcome.leases[0]?.expiresAt).toBeGreaterThan(Date.now());
    expect(isProtocol(outcome.foreign) && outcome.foreign.code).toBe("REPLICA_OWNED_BY_OTHER");
    expect(isProtocol(outcome.unknown) && outcome.unknown.code).toBe("REPLICA_UNKNOWN");
    expect(outcome.parts).toHaveLength(1);
  });
});
