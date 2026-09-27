import {
  OrgCommitSequence,
  ReplicaClientSequence,
  type CatalogRowWrite,
  type CommandReceipt,
  type SyncCommandEnvelope,
  type SyncTransactionGroup,
} from "@store/contracts";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";

export const FIXTURE_NOW = 1_700_000_000_000;

export const SPARE_BATCH_ID = decodeBatchId("batch-empty");
export const NEW_CATEGORY_ID = decodeCategoryId("cat-new");

const managed = {
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  deletedAt: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: LAST_UNIT_REPLICA_A,
  operationId: "seed",
  rowVersion: 1,
};

export const seedCatalogGroup: SyncTransactionGroup = {
  commitSequence: OrgCommitSequence.make("1"),
  operationId: "seed-catalog",
  decision: "accepted",
  changes: [
    {
      entity: "category",
      action: "upsert",
      entityId: "general",
      rowVersion: 1,
      row: { id: "general", name: "General", tracksPacks: true, ...managed },
    },
    {
      entity: "product",
      action: "upsert",
      entityId: LAST_UNIT_PRODUCT_ID,
      rowVersion: 1,
      row: {
        id: LAST_UNIT_PRODUCT_ID,
        name: "Ten pack",
        categoryId: "general",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        purchasePrice: 50,
        retailPrice: 100,
        unitPrice: 100,
        visible: true,
        ...managed,
      },
    },
    {
      entity: "batch",
      action: "upsert",
      entityId: LAST_UNIT_BATCH_ID,
      rowVersion: 1,
      row: {
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 10,
        ...managed,
      },
    },
  ],
};

export const seedSpareBatchGroup: SyncTransactionGroup = {
  commitSequence: OrgCommitSequence.make("2"),
  operationId: "seed-spare",
  decision: "accepted",
  changes: [
    {
      entity: "batch",
      action: "upsert",
      entityId: SPARE_BATCH_ID,
      rowVersion: 1,
      row: {
        id: SPARE_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-2",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 0,
        ...managed,
      },
    },
  ],
};

export const catalogEnvelope = (input: {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly writes: ReadonlyArray<CatalogRowWrite>;
}): SyncCommandEnvelope => {
  const command = {
    _tag: "catalogWrite" as const,
    payload: {
      commandId: input.operationId,
      deviceId: LAST_UNIT_REPLICA_A,
      occurredAt: FIXTURE_NOW + 1,
      writes: input.writes,
    },
  };
  return {
    organizationId: LAST_UNIT_ORGANIZATION_ID,
    epoch: LAST_UNIT_EPOCH,
    replicaId: LAST_UNIT_REPLICA_A,
    clientSequence: ReplicaClientSequence.make(input.clientSequence),
    operationId: input.operationId,
    payloadHash: canonicalPayloadHash(command),
    command,
  };
};

export const renameProductWrite = (name: string): CatalogRowWrite => ({
  entity: "product",
  action: "upsert",
  id: decodeProductId(LAST_UNIT_PRODUCT_ID),
  expectedRowVersion: 1,
  row: {
    name,
    categoryId: decodeCategoryId("general"),
    aisle: null,
    composition: null,
    strength: null,
    unitsPerPack: 1,
    purchasePrice: 50,
    retailPrice: 100,
    unitPrice: 100,
    visible: true,
  },
});

export const insertCategoryWrite: CatalogRowWrite = {
  entity: "category",
  action: "upsert",
  id: NEW_CATEGORY_ID,
  expectedRowVersion: null,
  row: { name: "Cold chain", tracksPacks: false },
};

export const deleteSpareBatchWrite: CatalogRowWrite = {
  entity: "batch",
  action: "delete",
  id: SPARE_BATCH_ID,
  expectedRowVersion: 1,
};

export const restockBatchWrite = (input: {
  readonly movementId: string;
  readonly unitQuantity: number;
}): CatalogRowWrite => ({
  entity: "batch",
  action: "upsert",
  id: decodeBatchId(LAST_UNIT_BATCH_ID),
  expectedRowVersion: 1,
  movementId: input.movementId,
  note: "Restock",
  row: {
    productId: decodeProductId(LAST_UNIT_PRODUCT_ID),
    batchNumber: "B-1",
    expiresAt: null,
    packQuantity: 0,
    unitQuantity: input.unitQuantity,
  },
});

export const rejectedReceipt = (
  envelope: SyncCommandEnvelope,
  commitSequence: string,
): CommandReceipt => ({
  operationId: envelope.operationId,
  replicaId: envelope.replicaId,
  clientSequence: envelope.clientSequence,
  payloadHash: envelope.payloadHash,
  decision: "rejected",
  commitSequence: OrgCommitSequence.make(commitSequence),
  result: {
    _tag: "rejected",
    code: "ENTITY_CONFLICT",
    message: "The authority refused the write.",
  },
});

export const acceptedCatalogReceipt = (
  envelope: SyncCommandEnvelope,
  commitSequence: string,
  rowsWritten: number,
): CommandReceipt => ({
  operationId: envelope.operationId,
  replicaId: envelope.replicaId,
  clientSequence: envelope.clientSequence,
  payloadHash: envelope.payloadHash,
  decision: "accepted",
  commitSequence: OrgCommitSequence.make(commitSequence),
  result: { _tag: "catalogWrite", rowsWritten },
});
