import { padDecimalSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
} from "@store/contracts/sync/fixtures";
import {
  batches,
  categories,
  inventoryState,
  products,
  replicas,
} from "@store/db/inventory.schema";

import { runSqliteTransaction, type SqliteDatabase } from "../sqlite";
import type { InventoryActor } from "./commands";

export const LAST_UNIT_USER_ID = "user-1";

export const lastUnitActor: InventoryActor = {
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  userId: LAST_UNIT_USER_ID,
};

export const seedLastUnitCatalog = (
  db: SqliteDatabase,
  input: {
    readonly organizationId?: string;
    readonly userId?: string;
    readonly unitQuantity?: number;
  } = {},
) => {
  const organizationId = input.organizationId ?? LAST_UNIT_ORGANIZATION_ID;
  const userId = input.userId ?? LAST_UNIT_USER_ID;
  const occurredAt = 1_700_000_000_000;
  runSqliteTransaction(db, (tx) => {
    tx.insert(inventoryState)
      .values({
        organizationId,
        status: "ready",
        importId: "import-test",
        releaseId: "release-test",
        incarnation: "incarnation-test",
        epoch: LAST_UNIT_EPOCH,
        commitSequence: padDecimalSequence("0"),
        retentionFloor: padDecimalSequence("0"),
      })
      .run();
    tx.insert(categories)
      .values({
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
      })
      .run();
    tx.insert(products)
      .values({
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
      })
      .run();
    tx.insert(batches)
      .values({
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: input.unitQuantity ?? 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        deletedAt: null,
        organizationId,
        createdByUserId: userId,
        updatedByUserId: userId,
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "seed-batch",
        rowVersion: 1,
      })
      .run();
    for (const replicaId of [LAST_UNIT_REPLICA_A, LAST_UNIT_REPLICA_B]) {
      tx.insert(replicas)
        .values({
          organizationId,
          replicaId,
          ownerUserId: userId,
          processedThroughClientSequence: padDecimalSequence("0"),
          registeredAt: occurredAt,
          lastSeenAt: occurredAt,
          deviceLabel: replicaId,
          lastClientSequence: padDecimalSequence("0"),
        })
        .run();
    }
  });
};
