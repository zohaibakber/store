import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import { batches, categories, products, replicaState } from "@store/db/replica.schema";

import {
  openReplicaStore,
  runReplicaTransaction,
  type ReplicaStore,
} from "../../src/replica/storage";

export const FIXTURE_USER_ID = "user-1";

export const FIXTURE_CATEGORY_ID = "general";

export const FIXTURE_OCCURRED_AT = 1_700_000_000_000;

export const seedReplicaTenUnits = (path?: string): ReplicaStore => {
  const store = openReplicaStore(path);
  runReplicaTransaction(store.db, (tx) => {
    tx.insert(replicaState)
      .values({
        id: "singleton",
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        userId: FIXTURE_USER_ID,
        replicaId: LAST_UNIT_REPLICA_A,
        epoch: LAST_UNIT_EPOCH,
        appliedCommitSequence: "0",
        nextClientSequence: "1",
        localCommitVersion: 0,
      })
      .run();
    tx.insert(categories)
      .values({
        id: FIXTURE_CATEGORY_ID,
        name: "General",
        tracksPacks: true,
        createdAt: FIXTURE_OCCURRED_AT,
        updatedAt: FIXTURE_OCCURRED_AT,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: FIXTURE_USER_ID,
        updatedByUserId: FIXTURE_USER_ID,
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "seed-category",
        rowVersion: 1,
      })
      .run();
    tx.insert(products)
      .values({
        id: LAST_UNIT_PRODUCT_ID,
        name: "Ten pack",
        categoryId: FIXTURE_CATEGORY_ID,
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        purchasePrice: 50,
        retailPrice: 100,
        unitPrice: 100,
        visible: true,
        createdAt: FIXTURE_OCCURRED_AT,
        updatedAt: FIXTURE_OCCURRED_AT,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: FIXTURE_USER_ID,
        updatedByUserId: FIXTURE_USER_ID,
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
        unitQuantity: 10,
        createdAt: FIXTURE_OCCURRED_AT,
        updatedAt: FIXTURE_OCCURRED_AT,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: FIXTURE_USER_ID,
        updatedByUserId: FIXTURE_USER_ID,
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "seed-batch",
        rowVersion: 1,
      })
      .run();
  });
  return store;
};
