import { describe, expect, it } from "@effect/vitest";
import {
  OPERATIONAL_SUBSCRIPTION,
  SnapshotId,
  SyncEpoch,
  SyncProtocolError,
  type AcquireSnapshotRequest,
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
  authorityState,
  batches,
  categories,
  downloadLeases,
  products,
  replicas,
  snapshotParts,
} from "@store/db/authority.schema";
import { asc } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Actor } from "../../src/authority/engine";
import { OrganizationAuthority } from "../../src/inventory/organization-authority";
import { scenario, TestAuthorities } from "./harness";

const isProtocol = Schema.is(SyncProtocolError);

const OCCURRED_AT = 1_700_000_000_000;

const actorFor = (organizationId: string, userId = "user-1"): Actor => ({
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

const openAuthority = (organizationId: string) =>
  Effect.gen(function* () {
    const authorities = yield* TestAuthorities;
    const { db } = yield* authorities.open(organizationId);
    yield* Effect.gen(function* () {
      yield* db.insert(authorityState).values({
        id: 1,
        organizationId,
        incarnation: "incarnation-test",
        epoch: LAST_UNIT_EPOCH,
        commitSequence: 2,
        retentionFloor: 0,
        createdAt: OCCURRED_AT,
      });
      yield* db.insert(categories).values({
        id: "general",
        name: "Category general",
        tracksPacks: true,
        ...metadata(organizationId, "seed-general"),
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
        ...metadata(organizationId, "seed-product"),
      });
      yield* db.insert(batches).values({
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 10,
        ...metadata(organizationId, "seed-batch"),
      });
      yield* db.insert(replicas).values({
        replicaId: LAST_UNIT_REPLICA_A,
        ownerUserId: "user-1",
        deviceLabel: LAST_UNIT_REPLICA_A,
        lastClientSequence: 0,
        processedThroughClientSequence: 0,
        registeredAt: OCCURRED_AT,
        lastSeenAt: OCCURRED_AT,
      });
    }).pipe(Effect.orDie);
    return { snapshots: yield* OrganizationAuthority, db };
  });

const operationalRequest: AcquireSnapshotRequest = {
  epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
  subscription: OPERATIONAL_SUBSCRIPTION,
};

const replicaRequest: AcquireSnapshotRequest = {
  ...operationalRequest,
  replicaId: LAST_UNIT_REPLICA_A,
};

describe("durable object snapshot acquisition", () => {
  it.effect("grants a download lease only for a replica the actor owns", () =>
    Effect.gen(function* () {
      const organizationId = decodeOrganizationId("org-snap-lease");
      const actor = actorFor(organizationId);
      const { snapshots, db } = yield* openAuthority(organizationId);
      const withoutReplica = yield* snapshots.acquireSnapshot(actor, operationalRequest);
      const leasesBefore = yield* db.select().from(downloadLeases).all();
      const withReplica = yield* snapshots.acquireSnapshot(actor, replicaRequest);
      const leases = yield* db.select().from(downloadLeases).all();
      const foreign = yield* snapshots
        .acquireSnapshot(actorFor(organizationId, "user-2"), replicaRequest)
        .pipe(Effect.flip);
      const unknown = yield* snapshots
        .acquireSnapshot(actor, { ...operationalRequest, replicaId: LAST_UNIT_REPLICA_B })
        .pipe(Effect.flip);
      const parts = yield* db
        .select({ partNumber: snapshotParts.partNumber })
        .from(snapshotParts)
        .orderBy(asc(snapshotParts.partNumber))
        .all();
      const part = yield* snapshots.readSnapshotPart(actor, withReplica.manifest.snapshotId, 1);
      const missingPart = yield* snapshots
        .readSnapshotPart(actor, withReplica.manifest.snapshotId, 2)
        .pipe(Effect.flip);
      const missingSnapshot = yield* snapshots
        .readSnapshotPart(actor, SnapshotId.make("missing"), 1)
        .pipe(Effect.flip);
      const outcome = {
        withoutReplica,
        leasesBefore,
        withReplica,
        leases,
        foreign,
        unknown,
        parts,
        part,
        missingPart,
        missingSnapshot,
      };
      expect(outcome.withoutReplica._tag).toBe("ready");
      expect(outcome.leasesBefore).toHaveLength(0);
      const manifest = outcome.withReplica.manifest;
      expect(manifest.snapshotId).toBe(outcome.withoutReplica.manifest.snapshotId);
      expect(outcome.leases).toHaveLength(1);
      expect(outcome.leases[0]).toMatchObject({
        replicaId: LAST_UNIT_REPLICA_A,
        snapshotId: manifest.snapshotId,
        pinnedHorizon: Number(manifest.horizon),
      });
      expect(outcome.leases[0]?.expiresAt).toBeGreaterThan(yield* Clock.currentTimeMillis);
      expect(isProtocol(outcome.foreign) && outcome.foreign.code).toBe("REPLICA_OWNED_BY_OTHER");
      expect(isProtocol(outcome.unknown) && outcome.unknown.code).toBe("REPLICA_UNKNOWN");
      expect(outcome.parts).toHaveLength(1);
      expect(outcome.part.sha256).toBe(manifest.parts[0]?.sha256);
      expect(isProtocol(outcome.missingPart) && outcome.missingPart.code).toBe(
        "SNAPSHOT_UNAVAILABLE",
      );
      expect(isProtocol(outcome.missingSnapshot) && outcome.missingSnapshot.code).toBe(
        "SNAPSHOT_UNAVAILABLE",
      );
    }).pipe(scenario),
  );
});
