import { createHash } from "node:crypto";

import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartPayload,
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
  snapshotJobs,
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
import {
  makeInventorySnapshots,
  SNAPSHOT_POLICY,
  type InventorySnapshotsContract,
  type SnapshotPolicy,
} from "../../src/inventory/snapshots";
import { countStatements } from "../lib/statement-count";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);

const encodePartPayload = Schema.encodeSync(Schema.fromJsonString(SnapshotPartPayload));

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

const openAuthority = (organizationId: string, policy: SnapshotPolicy = SNAPSHOT_POLICY) =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
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
    return { snapshots: makeInventorySnapshots(db, policy), db };
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

const decodePartPayload = Schema.decodeUnknownEffect(Schema.fromJsonString(SnapshotPartPayload));

const readPart = (
  snapshots: InventorySnapshotsContract,
  actor: InventoryActor,
  snapshotId: SnapshotId,
  partNumber: number,
) =>
  snapshots
    .readSnapshotPartEncoded(actor, snapshotId, partNumber)
    .pipe(Effect.flatMap((encoded) => Effect.orDie(decodePartPayload(encoded.json))));

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("postgres snapshot acquisition", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("builds a snapshot on the first acquire in one statement and serves its parts in one statement", async () => {
    const organizationId = decodeOrganizationId("org-snap-ready");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots } = yield* openAuthority(organizationId);
        const acquired = yield* countStatements(
          snapshots.acquireSnapshot(actor, operationalRequest),
        );
        const manifest = readyManifest(acquired.result);
        const encoded = yield* countStatements(
          snapshots.readSnapshotPartEncoded(actor, manifest.snapshotId, 1),
        );
        const part = yield* readPart(snapshots, actor, manifest.snapshotId, 1);
        const again = yield* countStatements(snapshots.acquireSnapshot(actor, operationalRequest));
        return { acquired, manifest, encoded, part, again };
      }),
    );
    expect(result.acquired.roundTrips).toBe(1);
    expect(result.encoded.roundTrips).toBe(1);
    expect(result.again.roundTrips).toBe(1);
    expect(result.manifest.horizon).toBe(OrgCommitSequence.make("2"));
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.manifest.parts).toHaveLength(1);
    expect(result.manifest.entityCounts).toEqual([
      { entity: "category", rowCount: 1 },
      { entity: "product", rowCount: 1 },
      { entity: "batch", rowCount: 1 },
    ]);
    expect(result.part.rows.map((row) => [row.entity, row.entityId])).toEqual([
      ["category", "general"],
      ["product", LAST_UNIT_PRODUCT_ID],
      ["batch", LAST_UNIT_BATCH_ID],
    ]);
    expect(result.encoded.result.json).toBe(encodePartPayload(result.part));
    expect(result.encoded.result.sha256).toBe(sha256Hex(result.encoded.result.json));
    expect(result.manifest.parts[0]).toEqual({
      partNumber: 1,
      objectKey: `${organizationId}/${result.manifest.snapshotId}/1`,
      byteLength: Buffer.byteLength(result.encoded.result.json, "utf8"),
      sha256: result.encoded.result.sha256,
    });
    expect(readyManifest(result.again.result).snapshotId).toBe(result.manifest.snapshotId);
  });

  it("chunks rows into parts of the configured size", async () => {
    const organizationId = decodeOrganizationId("org-snap-chunks");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId, {
          ...SNAPSHOT_POLICY,
          partRows: 2,
        });
        for (const id of ["tea", "spices", "zeta"]) yield* insertCategory(db, organizationId, id);
        const manifest = readyManifest(yield* snapshots.acquireSnapshot(actor, operationalRequest));
        const parts = [];
        for (const ref of manifest.parts) {
          parts.push(yield* readPart(snapshots, actor, manifest.snapshotId, ref.partNumber));
        }
        return { manifest, parts };
      }),
    );
    expect(result.manifest.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
    expect(result.parts.map((part) => part.rows.length)).toEqual([2, 2, 2]);
    expect(result.parts.flatMap((part) => part.rows.map((row) => row.entityId))).toEqual([
      "general",
      "spices",
      "tea",
      "zeta",
      LAST_UNIT_PRODUCT_ID,
      LAST_UNIT_BATCH_ID,
    ]);
  });

  it("reports the entity counts frozen into the snapshot, not the live tables", async () => {
    const organizationId = decodeOrganizationId("org-snap-counts");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const acquired = readyManifest(yield* snapshots.acquireSnapshot(actor, operationalRequest));
        yield* insertCategory(db, organizationId, "late-category");
        const again = readyManifest(yield* snapshots.acquireSnapshot(actor, operationalRequest));
        return { acquired, again };
      }),
    );
    expect(result.again.snapshotId).toBe(result.acquired.snapshotId);
    expect(result.again.entityCounts).toEqual(result.acquired.entityCounts);
  });

  it("rebuilds a stale snapshot once the rebuild interval has passed", async () => {
    const organizationId = decodeOrganizationId("org-snap-stale");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId, {
          ...SNAPSHOT_POLICY,
          lagTransactions: 1,
        });
        const first = readyManifest(yield* snapshots.acquireSnapshot(actor, operationalRequest));
        yield* db
          .update(inventoryState)
          .set({ commitSequence: "5" })
          .where(eq(inventoryState.organizationId, organizationId));
        const withinInterval = readyManifest(
          yield* snapshots.acquireSnapshot(actor, operationalRequest),
        );
        yield* db
          .update(snapshotJobs)
          .set({ publishedAt: 0 })
          .where(eq(snapshotJobs.organizationId, organizationId));
        const rebuilt = readyManifest(yield* snapshots.acquireSnapshot(actor, operationalRequest));
        return { first, withinInterval, rebuilt };
      }),
    );
    expect(result.withinInterval.snapshotId).toBe(result.first.snapshotId);
    expect(result.rebuilt.snapshotId).not.toBe(result.first.snapshotId);
    expect(result.rebuilt.horizon).toBe(OrgCommitSequence.make("5"));
  });

  it("shares one build between concurrent acquires", async () => {
    const organizationId = decodeOrganizationId("org-snap-concurrent");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots, db } = yield* openAuthority(organizationId);
        const acquired = yield* Effect.all(
          Array.from({ length: 4 }, () => snapshots.acquireSnapshot(actor, operationalRequest)),
          { concurrency: "unbounded" },
        );
        const jobs = yield* db
          .select({ snapshotId: snapshotJobs.snapshotId })
          .from(snapshotJobs)
          .where(eq(snapshotJobs.organizationId, organizationId));
        return { ids: acquired.map((entry) => readyManifest(entry).snapshotId), jobs };
      }),
    );
    expect(new Set(result.ids).size).toBe(1);
    expect(result.jobs).toHaveLength(1);
  });

  it("rejects missing snapshot parts, unknown snapshots, and a wrong epoch", async () => {
    const organizationId = decodeOrganizationId("org-snap-fail");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { snapshots } = yield* openAuthority(organizationId);
        const manifest = readyManifest(yield* snapshots.acquireSnapshot(actor, operationalRequest));
        const missingPart = yield* snapshots
          .readSnapshotPartEncoded(actor, manifest.snapshotId, 99)
          .pipe(Effect.flip);
        const wrongEpoch = yield* snapshots
          .acquireSnapshot(actor, { ...operationalRequest, epoch: SyncEpoch.make("9") })
          .pipe(Effect.flip);
        const unknownSnapshot = yield* snapshots
          .readSnapshotPartEncoded(actor, SnapshotId.make("missing-snapshot-idxx"), 1)
          .pipe(Effect.flip);
        const unknownOrganization = yield* snapshots
          .acquireSnapshot(actorFor("org-snap-missing"), operationalRequest)
          .pipe(Effect.flip);
        return { missingPart, wrongEpoch, unknownSnapshot, unknownOrganization };
      }),
    );
    expect(isProtocol(outcome.missingPart) && outcome.missingPart.code).toBe(
      "SNAPSHOT_UNAVAILABLE",
    );
    expect(isProtocol(outcome.wrongEpoch) && outcome.wrongEpoch.code).toBe("EPOCH_MISMATCH");
    expect(isProtocol(outcome.unknownSnapshot) && outcome.unknownSnapshot.code).toBe(
      "SNAPSHOT_UNAVAILABLE",
    );
    expect(isProtocol(outcome.unknownOrganization) && outcome.unknownOrganization.code).toBe(
      "EPOCH_MISMATCH",
    );
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
        const withReplica = yield* countStatements(
          snapshots.acquireSnapshot(actor, replicaRequest),
        );
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
    expect(outcome.withReplica.roundTrips).toBe(1);
    const manifest = readyManifest(outcome.withReplica.result);
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
