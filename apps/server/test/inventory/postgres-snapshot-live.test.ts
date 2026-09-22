import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
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
import { batches, categories, inventoryState, products, replicas } from "@store/db/postgres/schema";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryLive } from "../../src/inventory/live-tickets";
import type { InventoryActor } from "../../src/inventory/model";
import { makeInventorySnapshots } from "../../src/inventory/snapshots";
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
      deletedAt: null,
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

describe("postgres snapshot publication and live tickets", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("publishes a ready snapshot and returns its parts", async () => {
    const organizationId = decodeOrganizationId("org-snap-ready");
    const actor = actorFor(organizationId);
    const result = await run(
      Effect.gen(function* () {
        const { snapshots } = yield* openAuthority(organizationId);
        const acquired = yield* snapshots.acquireSnapshot(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        if (acquired._tag !== "ready") {
          return yield* Effect.fail(new Error("expected ready snapshot"));
        }
        const part = yield* snapshots.readSnapshotPart(
          actor,
          acquired.manifest.snapshotId,
          acquired.manifest.parts[0]?.partNumber ?? 1,
        );
        const again = yield* snapshots.acquireSnapshot(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        return { acquired, part, again };
      }),
    );
    expect(result.acquired._tag).toBe("ready");
    if (result.acquired._tag !== "ready") return;
    expect(result.acquired.manifest.horizon).toBe(OrgCommitSequence.make("2"));
    expect(result.acquired.manifest.parts.length).toBeGreaterThan(0);
    expect(result.part.rows.some((row) => row.entity === "batch")).toBe(true);
    expect(result.again._tag).toBe("ready");
    if (result.again._tag === "ready") {
      expect(result.again.manifest.snapshotId).toBe(result.acquired.manifest.snapshotId);
    }
  });

  it("rejects missing snapshot parts and wrong epoch", async () => {
    const organizationId = decodeOrganizationId("org-snap-fail");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { snapshots } = yield* openAuthority(organizationId);
        const acquired = yield* snapshots.acquireSnapshot(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        if (acquired._tag !== "ready") {
          return yield* Effect.fail(new Error("expected ready snapshot"));
        }
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
});
