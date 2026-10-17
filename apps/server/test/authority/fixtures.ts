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
  products,
  replicas,
} from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import * as Effect from "effect/Effect";

export const seedLastUnit = (db: ReplicaDb, organizationId: string, unitQuantity = 1) =>
  Effect.gen(function* () {
    const occurredAt = 1_700_000_000_000;
    const userId = "user-1";
    const stamp = {
      createdAt: occurredAt,
      updatedAt: occurredAt,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
      deviceId: LAST_UNIT_REPLICA_A,
      rowVersion: 1,
    };
    yield* db.insert(authorityState).values({
      id: 1,
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: 0,
      retentionFloor: 0,
      createdAt: occurredAt,
    });
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      operationId: "seed-category",
      ...stamp,
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
      operationId: "seed-product",
      ...stamp,
    });
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity,
      operationId: "seed-batch",
      ...stamp,
    });
    for (const replicaId of [LAST_UNIT_REPLICA_A, LAST_UNIT_REPLICA_B]) {
      yield* db.insert(replicas).values({
        replicaId,
        ownerUserId: userId,
        deviceLabel: replicaId,
        lastClientSequence: 0,
        processedThroughClientSequence: 0,
        registeredAt: occurredAt,
        lastSeenAt: occurredAt,
      });
    }
  });
