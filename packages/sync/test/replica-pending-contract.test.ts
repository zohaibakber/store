import { describe, expect, it } from "@effect/vitest";
import {
  OrgCommitSequence,
  ReplicaClientSequence,
  SnapshotId,
  SnapshotPartHash,
  type CatalogRowWrite,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncCommandEnvelope,
  type SyncEntity,
  type SyncTransactionGroup,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { decodeInvoiceId, decodeInvoiceItemId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerACommand,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { stockOverlays } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { IndexedDbSubsetRow } from "../src/replica/indexeddb/query";
import { entityStore } from "../src/replica/indexeddb/schema";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction } from "../src/replica/storage";
import type { ReplicaStoreContract } from "../src/replica/store";
import { enqueueRequestOf } from "./lib/enqueue";
import {
  acceptedCatalogReceipt,
  catalogEnvelope,
  deleteSpareBatchWrite,
  deliveryWrite,
  DELIVERY_BATCH_ID,
  DELIVERY_MOVEMENT_ID,
  FIXTURE_NOW,
  insertCategoryWrite,
  NEW_CATEGORY_ID,
  ORDER_ID,
  ORDER_LINE_ID,
  orderLineWrite,
  orderWrite,
  placeOrderWrites,
  rejectedReceipt,
  renameProductWrite,
  restockBatchWrite,
  seedCatalogGroup,
  seedSpareBatchGroup,
  SPARE_BATCH_ID,
  SUPPLIER_ID,
  SUPPLIER_NAME,
  supplierWrite,
} from "./lib/pending-fixture";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const EntityCell = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
const decodeEntityRow = Schema.decodeUnknownSync(Schema.Record(Schema.String, EntityCell));

type EntityRow = IndexedDbSubsetRow;

type Harness = {
  readonly store: ReplicaStoreContract;
  readonly rows: (entity: SyncEntity) => Effect.Effect<ReadonlyArray<EntityRow>, unknown>;
  readonly overlayCount: () => Effect.Effect<number, unknown>;
  readonly close: () => Effect.Effect<void, unknown>;
};

const makeSqliteHarness = Effect.fn("harness.sqlite")(function* () {
  const scope = yield* Scope.make();
  const handle = yield* Scope.provide(seedReplicaTenUnits(), scope);
  const store = yield* makeSqliteReplicaStore(handle, "sqlite-pending");
  yield* store.applyTransactionGroup(seedSpareBatchGroup);
  return {
    store,
    rows: (entity: SyncEntity) =>
      runReplicaTransaction(handle, (tx) =>
        tx.select().from(syncEntityRows[entity].table).all(),
      ).pipe(Effect.map((rows) => rows.map((row) => decodeEntityRow(row)))),
    overlayCount: () =>
      runReplicaTransaction(handle, (tx) => tx.select().from(stockOverlays).all()).pipe(
        Effect.map((rows) => rows.length),
      ),
    close: () => Scope.close(scope, Exit.void),
  } satisfies Harness;
});

let databaseCounter = 0;

const makeIndexedHarness = Effect.fn("harness.indexeddb")(function* () {
  databaseCounter += 1;
  const databaseName = `replica-pending-${databaseCounter}`;
  const store = yield* makeIndexedDbReplicaStore({
    databaseName,
    databaseIdentity: databaseName,
    identity: {
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      userId: "user-1",
      replicaId: LAST_UNIT_REPLICA_A,
    },
    indexedDB,
    IDBKeyRange,
  });
  yield* store.applyTransactionGroup(seedCatalogGroup);
  yield* store.applyTransactionGroup(seedSpareBatchGroup);
  return {
    store,
    rows: (entity: SyncEntity) =>
      store
        .querySubset({
          table: entityStore(entity),
          scan: { _tag: "generationPrefix", reverse: false },
          residual: undefined,
          orderBy: [],
          limit: 200,
          offset: 0,
        })
        .pipe(Effect.map((result) => result.rows)),
    overlayCount: () => Effect.succeed(0),
    close: () =>
      store
        .dispose()
        .pipe(Effect.tap(() => Effect.sync(() => indexedDB.deleteDatabase(databaseName)))),
  } satisfies Harness;
});

const invoiceEnvelopeFor = (input: {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly quantity: number;
  readonly invoiceNumber: number;
}): SyncCommandEnvelope => {
  const command = {
    _tag: "issueInvoice" as const,
    payload: {
      ...lastUnitBuyerACommand,
      commandId: input.operationId,
      invoiceId: decodeInvoiceId(input.operationId),
      invoiceNumber: input.invoiceNumber,
      input: {
        customerName: null,
        items: [
          {
            productId: LAST_UNIT_PRODUCT_ID,
            batchId: LAST_UNIT_BATCH_ID,
            quantity: input.quantity,
            quantityType: "unit" as const,
            salePrice: 100,
          },
        ],
      },
      allocations: [
        {
          invoiceItemId: decodeInvoiceItemId(`${input.operationId}-item`),
          saleMovementId: `${input.operationId}-sale`,
          openPackMovementId: null,
          productId: LAST_UNIT_PRODUCT_ID,
          batchId: LAST_UNIT_BATCH_ID,
          quantity: input.quantity,
          quantityType: "unit" as const,
          salePrice: 100,
          packsOpened: 0,
        },
      ],
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

const authoritativeInvoiceGroup = (input: {
  readonly operationId: string;
  readonly commitSequence: string;
  readonly invoiceNumber: number;
  readonly invoiceId?: string;
}): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(input.commitSequence),
  operationId: input.operationId,
  decision: "accepted",
  changes: [
    {
      entity: "invoice",
      action: "upsert",
      entityId: input.invoiceId ?? lastUnitBuyerAEnvelope.operationId,
      rowVersion: 1,
      row: {
        id: input.invoiceId ?? lastUnitBuyerAEnvelope.operationId,
        invoiceNumber: input.invoiceNumber,
        customerName: null,
        total: 100,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: "user-1",
        updatedByUserId: "user-1",
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: input.operationId,
        rowVersion: 1,
      },
    },
  ],
});

const remoteProductGroup: SyncTransactionGroup = {
  commitSequence: OrgCommitSequence.make("7"),
  operationId: "remote-op",
  decision: "accepted",
  changes: [
    {
      entity: "product",
      action: "upsert",
      entityId: LAST_UNIT_PRODUCT_ID,
      rowVersion: 4,
      row: {
        id: LAST_UNIT_PRODUCT_ID,
        name: "Remote name",
        categoryId: "general",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        purchasePrice: 50,
        retailPrice: 100,
        unitPrice: 100,
        visible: true,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW + 50,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: "user-1",
        updatedByUserId: "user-2",
        deviceId: "replica-b",
        operationId: "remote-op",
        rowVersion: 4,
      },
    },
  ],
};

const remoteColdChainGroup: SyncTransactionGroup = {
  commitSequence: OrgCommitSequence.make("8"),
  operationId: "remote-category-op",
  decision: "accepted",
  changes: [
    {
      entity: "category",
      action: "upsert",
      entityId: "remote-cold",
      rowVersion: 1,
      row: {
        id: "remote-cold",
        name: "Cold chain",
        tracksPacks: true,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: "user-2",
        updatedByUserId: "user-2",
        deviceId: "replica-b",
        operationId: "remote-category-op",
        rowVersion: 1,
      },
    },
  ],
};

const snapshotManifest: SnapshotManifest = {
  snapshotId: SnapshotId.make("snapshot-pending-1"),
  epoch: LAST_UNIT_EPOCH,
  subscription: "operational",
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("9"),
  parts: [
    {
      partNumber: 1,
      byteLength: 1,
      sha256: SnapshotPartHash.make("b".repeat(64)),
    },
  ],
  entityCounts: [{ entity: "batch", rowCount: 1 }],
  digestVersion: 3,
};

const snapshotPart: SnapshotPartPayload = {
  snapshotId: snapshotManifest.snapshotId,
  partNumber: 1,
  rows: seedCatalogGroup.changes.map((change) => ({
    entity: change.entity,
    entityId: change.entityId,
    rowVersion: 2,
    row: change.row,
  })),
};

const deleteGroup = (input: {
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly commitSequence: string;
  readonly operationId: string;
}): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(input.commitSequence),
  operationId: input.operationId,
  decision: "accepted",
  changes: [
    {
      entity: input.entity,
      action: "delete",
      entityId: input.entityId,
      rowVersion: 2,
      row: { id: input.entityId, deletedAt: FIXTURE_NOW + 10 },
    },
  ],
});

const findRow = (rows: ReadonlyArray<EntityRow>, id: string): EntityRow | undefined =>
  rows.find((row) => row["id"] === id);

const adapters = [
  { name: "sqlite", make: makeSqliteHarness },
  { name: "indexeddb", make: makeIndexedHarness },
] as const;

for (const adapter of adapters) {
  describe(`pending projections on ${adapter.name}`, () => {
    const withHarness = <A>(use: (harness: Harness) => Effect.Effect<A, unknown>) =>
      Effect.acquireUseRelease(adapter.make(), use, (harness) => Effect.orDie(harness.close()));

    it.effect("makes an offline invoice readable with a pending mark", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
          const invoiceRows = yield* harness.rows("invoice");
          const itemRows = yield* harness.rows("invoiceItem");
          const movementRows = yield* harness.rows("stockMovement");
          const marks = yield* harness.store.readPendingMarks();
          expect(invoiceRows).toHaveLength(1);
          expect(invoiceRows[0]?.["total"]).toBe(100);
          expect(itemRows[0]?.["productName"]).toBe("Ten pack");
          expect(itemRows[0]?.["batchNumber"]).toBe("B-1");
          expect(movementRows[0]?.["type"]).toBe("sale");
          expect(movementRows[0]?.["unitDelta"]).toBe(-1);
          expect(
            marks.filter((mark) => mark.operationId === lastUnitBuyerAEnvelope.operationId),
          ).toHaveLength(3);
        }),
      ),
    );

    it.effect("replaces shadow rows with authoritative rows and clears the mark", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
          yield* harness.store.applyTransactionGroup(
            authoritativeInvoiceGroup({
              operationId: lastUnitBuyerAEnvelope.operationId,
              commitSequence: "5",
              invoiceNumber: 7,
            }),
          );
          const invoiceRows = yield* harness.rows("invoice");
          const marks = yield* harness.store.readPendingMarks();
          expect(invoiceRows).toHaveLength(1);
          expect(invoiceRows[0]?.["invoiceNumber"]).toBe(7);
          expect(marks).toHaveLength(0);
          const status = yield* harness.store.readCommandStatus(lastUnitBuyerAEnvelope.operationId);
          expect(status).toBe("integrated");
        }),
      ),
    );

    it.effect("restores prior state when the authority rejects the command", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = catalogEnvelope({
            operationId: "catalog-1",
            clientSequence: "1",
            writes: [insertCategoryWrite, renameProductWrite("Renamed")],
          });
          yield* harness.store.enqueueCommand(enqueueRequestOf(envelope, 1));
          const shadowedCategories = yield* harness.rows("category");
          const shadowedProducts = yield* harness.rows("product");
          expect(findRow(shadowedCategories, NEW_CATEGORY_ID)).toBeDefined();
          expect(findRow(shadowedProducts, LAST_UNIT_PRODUCT_ID)?.["name"]).toBe("Renamed");

          yield* harness.store.claimNextUpload({ claimId: "claim-1", claimedAt: 10 });
          yield* harness.store.settleUploadClaim("claim-1", rejectedReceipt(envelope, "6"));

          const restoredCategories = yield* harness.rows("category");
          const restoredProducts = yield* harness.rows("product");
          const marks = yield* harness.store.readPendingMarks();
          expect(findRow(restoredCategories, NEW_CATEGORY_ID)).toBeUndefined();
          expect(findRow(restoredProducts, LAST_UNIT_PRODUCT_ID)?.["name"]).toBe("Ten pack");
          expect(marks).toHaveLength(0);
        }),
      ),
    );

    it.effect("removes the row on an authoritative delete change", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const before = yield* harness.rows("batch");
          expect(findRow(before, SPARE_BATCH_ID)).toBeDefined();
          yield* harness.store.applyTransactionGroup(
            deleteGroup({
              entity: "batch",
              entityId: SPARE_BATCH_ID,
              commitSequence: "8",
              operationId: "remote-delete-batch",
            }),
          );
          const after = yield* harness.rows("batch");
          expect(findRow(after, SPARE_BATCH_ID)).toBeUndefined();
        }),
      ),
    );

    it.effect("keeps invoice items readable when their product is deleted", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
          yield* harness.store.applyTransactionGroup(
            deleteGroup({
              entity: "product",
              entityId: LAST_UNIT_PRODUCT_ID,
              commitSequence: "9",
              operationId: "remote-delete-product",
            }),
          );
          const productRows = yield* harness.rows("product");
          const itemRows = yield* harness.rows("invoiceItem");
          expect(findRow(productRows, LAST_UNIT_PRODUCT_ID)).toBeUndefined();
          expect(itemRows).toHaveLength(1);
          expect(itemRows[0]?.["productName"]).toBe("Ten pack");
          expect(itemRows[0]?.["batchNumber"]).toBe("B-1");
        }),
      ),
    );

    it.effect("stores no deletedAt field for an authoritative image carrying one", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.applyTransactionGroup(remoteProductGroup);
          const productRows = yield* harness.rows("product");
          const row = findRow(productRows, LAST_UNIT_PRODUCT_ID);
          expect(row?.["name"]).toBe("Remote name");
          expect(Object.keys(row ?? {})).not.toContain("deletedAt");
        }),
      ),
    );

    it.effect("restores a deleted row when the authority rejects the delete", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = catalogEnvelope({
            operationId: "catalog-delete-1",
            clientSequence: "1",
            writes: [deleteSpareBatchWrite],
          });
          yield* harness.store.enqueueCommand(enqueueRequestOf(envelope, 1));
          const shadowed = yield* harness.rows("batch");
          expect(findRow(shadowed, SPARE_BATCH_ID)).toBeUndefined();

          yield* harness.store.claimNextUpload({ claimId: "claim-delete", claimedAt: 10 });
          yield* harness.store.settleUploadClaim("claim-delete", rejectedReceipt(envelope, "6"));

          const restored = yield* harness.rows("batch");
          const marks = yield* harness.store.readPendingMarks();
          expect(findRow(restored, SPARE_BATCH_ID)?.["batchNumber"]).toBe("B-2");
          expect(marks).toHaveLength(0);
        }),
      ),
    );

    it.effect("projects a pending adjustment movement without a stock overlay", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = catalogEnvelope({
            operationId: "catalog-4",
            clientSequence: "1",
            writes: [restockBatchWrite({ movementId: "restock-1", unitQuantity: 25 })],
          });
          yield* harness.store.enqueueCommand(enqueueRequestOf(envelope, 1));
          const batchRows = yield* harness.rows("batch");
          const movementRows = yield* harness.rows("stockMovement");
          const overlays = yield* harness.overlayCount();
          expect(findRow(batchRows, LAST_UNIT_BATCH_ID)?.["unitQuantity"]).toBe(25);
          expect(findRow(movementRows, "restock-1")?.["unitDelta"]).toBe(15);
          expect(findRow(movementRows, "restock-1")?.["type"]).toBe("stock_in");
          expect(overlays).toBe(0);
        }),
      ),
    );

    it.effect("re-applies shadows for outstanding commands after snapshot activation", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
          yield* Effect.scoped(harness.store.beginSnapshotImport(snapshotManifest));
          yield* harness.store.importSnapshotPart(snapshotManifest, snapshotPart);
          yield* harness.store.activateSnapshot(snapshotManifest.snapshotId);
          const invoiceRows = yield* harness.rows("invoice");
          const marks = yield* harness.store.readPendingMarks();
          expect(invoiceRows).toHaveLength(1);
          expect(
            marks.filter((mark) => mark.operationId === lastUnitBuyerAEnvelope.operationId),
          ).toHaveLength(3);
        }),
      ),
    );

    it.effect("refuses an enqueue that exceeds durable stock", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = invoiceEnvelopeFor({
            operationId: "oversold",
            clientSequence: "1",
            quantity: 50,
            invoiceNumber: 3,
          });
          const failure = yield* Effect.flip(
            harness.store.enqueueCommand(enqueueRequestOf(envelope, 1)),
          );
          expect(failure._tag).toBe("SyncProtocolError");
          const invoiceRows = yield* harness.rows("invoice");
          expect(invoiceRows).toHaveLength(0);
        }),
      ),
    );

    it.effect("produces no duplicate shadow rows on idempotent replay", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
          const replay = yield* harness.store.enqueueCommand(
            enqueueRequestOf(lastUnitBuyerAEnvelope, 2),
          );
          const itemRows = yield* harness.rows("invoiceItem");
          const marks = yield* harness.store.readPendingMarks();
          expect(replay.notice).toBeUndefined();
          expect(itemRows).toHaveLength(1);
          expect(marks).toHaveLength(3);
        }),
      ),
    );

    it.effect("renumbers a shadow invoice when a remote invoice claims its number", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = invoiceEnvelopeFor({
            operationId: "shadow-five",
            clientSequence: "1",
            quantity: 1,
            invoiceNumber: 5,
          });
          yield* harness.store.enqueueCommand(enqueueRequestOf(envelope, 1));
          const applied = yield* harness.store.applyTransactionGroup(
            authoritativeInvoiceGroup({
              operationId: "remote-invoice",
              commitSequence: "6",
              invoiceNumber: 5,
              invoiceId: "remote-inv",
            }),
          );
          const afterRemote = yield* harness.rows("invoice");
          expect(findRow(afterRemote, "remote-inv")?.["invoiceNumber"]).toBe(5);
          expect(findRow(afterRemote, "shadow-five")?.["invoiceNumber"]).toBe(6);
          expect(applied.notice?.touchedKeys).toContain("invoice:shadow-five");
          const marksBefore = yield* harness.store.readPendingMarks();
          expect(
            marksBefore.filter(
              (mark) => mark.entity === "invoice" && mark.entityId === "shadow-five",
            ),
          ).toHaveLength(1);

          yield* harness.store.applyTransactionGroup(
            authoritativeInvoiceGroup({
              operationId: "shadow-five",
              commitSequence: "7",
              invoiceNumber: 11,
              invoiceId: "shadow-five",
            }),
          );
          const afterIntegration = yield* harness.rows("invoice");
          const marksAfter = yield* harness.store.readPendingMarks();
          expect(findRow(afterIntegration, "shadow-five")?.["invoiceNumber"]).toBe(11);
          expect(marksAfter).toHaveLength(0);
        }),
      ),
    );

    it.effect("keeps a command pending and claimable after many failed upload cycles", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const claimed = yield* harness.store.claimNextUpload({
              claimId: `claim-${attempt}`,
              claimedAt: attempt,
            });
            expect(claimed.value?.operationId).toBe(lastUnitBuyerAEnvelope.operationId);
            yield* harness.store.releaseUploadClaim(
              lastUnitBuyerAEnvelope.operationId,
              `claim-${attempt}`,
            );
          }
          const status = yield* harness.store.readCommandStatus(lastUnitBuyerAEnvelope.operationId);
          const invoiceRows = yield* harness.rows("invoice");
          const marks = yield* harness.store.readPendingMarks();
          const next = yield* harness.store.claimNextUpload({
            claimId: "claim-last",
            claimedAt: 99,
          });
          expect(status).toBe("pending");
          expect(invoiceRows).toHaveLength(1);
          expect(marks).toHaveLength(3);
          expect(next.value?.operationId).toBe(lastUnitBuyerAEnvelope.operationId);
          expect(next.value?.attempts).toBe(21);
          expect(next.value?.outcomeUncertain).toBe(true);
        }),
      ),
    );

    const rejectNext = (harness: Harness, envelope: SyncCommandEnvelope, commitSequence: string) =>
      Effect.gen(function* () {
        const claimId = `reject-${envelope.operationId}`;
        const claimed = yield* harness.store.claimNextUpload({ claimId, claimedAt: 10 });
        expect(claimed.value?.operationId).toBe(envelope.operationId);
        yield* harness.store.settleUploadClaim(claimId, rejectedReceipt(envelope, commitSequence));
      });

    const firstRename = catalogEnvelope({
      operationId: "rename-1",
      clientSequence: "1",
      writes: [renameProductWrite("First")],
    });
    const secondRename = catalogEnvelope({
      operationId: "rename-2",
      clientSequence: "2",
      writes: [renameProductWrite("Second")],
    });

    const productName = (harness: Harness) =>
      harness
        .rows("product")
        .pipe(Effect.map((rows) => findRow(rows, LAST_UNIT_PRODUCT_ID)?.["name"]));

    it.effect("restores the original row when two stacked renames are both rejected", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(firstRename, 1));
          yield* harness.store.enqueueCommand(enqueueRequestOf(secondRename, 2));
          expect(yield* productName(harness)).toBe("Second");

          yield* rejectNext(harness, firstRename, "10");
          expect(yield* productName(harness)).toBe("Second");

          yield* rejectNext(harness, secondRename, "11");
          expect(yield* productName(harness)).toBe("Ten pack");
          expect(yield* harness.store.readPendingMarks()).toHaveLength(0);
        }),
      ),
    );

    it.effect("keeps a remote update when an earlier stacked rename is rejected", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(firstRename, 1));
          yield* harness.store.enqueueCommand(enqueueRequestOf(secondRename, 2));
          yield* harness.store.applyTransactionGroup(remoteProductGroup);
          expect(yield* productName(harness)).toBe("Remote name");
          const marks = yield* harness.store.readPendingMarks();
          expect(marks.filter((mark) => mark.entity === "product")).toHaveLength(0);

          yield* rejectNext(harness, firstRename, "10");
          expect(yield* productName(harness)).toBe("Remote name");

          yield* rejectNext(harness, secondRename, "11");
          expect(yield* productName(harness)).toBe("Remote name");
          expect(yield* harness.store.readPendingMarks()).toHaveLength(0);
        }),
      ),
    );

    it.effect("keeps a remotely deleted row deleted when shadowing renames are rejected", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(firstRename, 1));
          yield* harness.store.enqueueCommand(enqueueRequestOf(secondRename, 2));
          yield* harness.store.applyTransactionGroup(
            deleteGroup({
              entity: "product",
              entityId: LAST_UNIT_PRODUCT_ID,
              commitSequence: "9",
              operationId: "remote-delete-product",
            }),
          );

          yield* rejectNext(harness, firstRename, "10");
          yield* rejectNext(harness, secondRename, "11");
          expect(yield* productName(harness)).toBeUndefined();
          expect(yield* harness.store.readPendingMarks()).toHaveLength(0);
        }),
      ),
    );

    it.effect("removes catalog rows absent from an activated snapshot", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          expect(findRow(yield* harness.rows("batch"), SPARE_BATCH_ID)).toBeDefined();
          yield* Effect.scoped(harness.store.beginSnapshotImport(snapshotManifest));
          yield* harness.store.importSnapshotPart(snapshotManifest, snapshotPart);
          yield* harness.store.activateSnapshot(snapshotManifest.snapshotId);
          const batchRows = yield* harness.rows("batch");
          expect(findRow(batchRows, SPARE_BATCH_ID)).toBeUndefined();
          expect(findRow(batchRows, LAST_UNIT_BATCH_ID)).toBeDefined();
        }),
      ),
    );

    it.effect("renames a colliding category shadow when snapshot activation re-applies it", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(
            enqueueRequestOf(
              catalogEnvelope({
                operationId: "local-tea",
                clientSequence: "1",
                writes: [
                  {
                    entity: "category",
                    action: "upsert",
                    id: NEW_CATEGORY_ID,
                    expectedRowVersion: null,
                    row: { name: "Tea", tracksPacks: false },
                  },
                ],
              }),
              1,
            ),
          );
          const teaPart: SnapshotPartPayload = {
            ...snapshotPart,
            rows: [
              ...snapshotPart.rows,
              {
                entity: "category",
                entityId: "remote-tea",
                rowVersion: 1,
                row: {
                  id: "remote-tea",
                  name: "Tea",
                  tracksPacks: true,
                  createdAt: FIXTURE_NOW,
                  updatedAt: FIXTURE_NOW,
                  organizationId: LAST_UNIT_ORGANIZATION_ID,
                  createdByUserId: "user-2",
                  updatedByUserId: "user-2",
                  deviceId: "replica-b",
                  operationId: "remote-tea-op",
                  rowVersion: 1,
                },
              },
            ],
          };
          yield* Effect.scoped(harness.store.beginSnapshotImport(snapshotManifest));
          yield* harness.store.importSnapshotPart(snapshotManifest, teaPart);
          yield* harness.store.activateSnapshot(snapshotManifest.snapshotId);
          const categoryRows = yield* harness.rows("category");
          expect(findRow(categoryRows, "remote-tea")?.["name"]).toBe("Tea");
          expect(findRow(categoryRows, NEW_CATEGORY_ID)?.["name"]).toBe("Tea (2)");
          const marks = yield* harness.store.readPendingMarks();
          expect(marks.filter((mark) => mark.entityId === NEW_CATEGORY_ID)).toHaveLength(1);
        }),
      ),
    );

    it.effect("renames a colliding category shadow before writing the remote category", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = catalogEnvelope({
            operationId: "local-category",
            clientSequence: "1",
            writes: [insertCategoryWrite],
          });
          yield* harness.store.enqueueCommand(enqueueRequestOf(envelope, 1));
          const applied = yield* harness.store.applyTransactionGroup(remoteColdChainGroup);
          const afterRemote = yield* harness.rows("category");
          expect(findRow(afterRemote, "remote-cold")?.["name"]).toBe("Cold chain");
          expect(findRow(afterRemote, NEW_CATEGORY_ID)?.["name"]).toBe("Cold chain (2)");
          expect(applied.notice?.touchedKeys).toContain(`category:${NEW_CATEGORY_ID}`);

          yield* rejectNext(harness, envelope, "12");
          const afterReject = yield* harness.rows("category");
          expect(findRow(afterReject, NEW_CATEGORY_ID)).toBeUndefined();
          expect(findRow(afterReject, "remote-cold")?.["name"]).toBe("Cold chain");
          expect(yield* harness.store.readPendingMarks()).toHaveLength(0);
        }),
      ),
    );

    it.effect("applies the same authoritative transaction twice as a no-op", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const group = authoritativeInvoiceGroup({
            operationId: lastUnitBuyerAEnvelope.operationId,
            commitSequence: "5",
            invoiceNumber: 7,
          });
          yield* harness.store.applyTransactionGroup(group);
          const first = yield* harness.rows("invoice");
          yield* harness.store.applyTransactionGroup(group);
          const second = yield* harness.rows("invoice");
          expect(first).toHaveLength(1);
          expect(second).toEqual(first);
        }),
      ),
    );
    const placeOrder = catalogEnvelope({
      operationId: "order-place",
      clientSequence: "1",
      writes: placeOrderWrites,
    });

    const purchasing = (clientSequence: string, writes: ReadonlyArray<CatalogRowWrite>) =>
      catalogEnvelope({ operationId: `purchasing-${clientSequence}`, clientSequence, writes });

    const refusalOf = (harness: Harness, writes: ReadonlyArray<CatalogRowWrite>) =>
      Effect.flip(harness.store.enqueueCommand(enqueueRequestOf(purchasing("99", writes), 1))).pipe(
        Effect.map((failure) => (failure._tag === "SyncProtocolError" ? failure.code : failure)),
      );

    const orderDelete: CatalogRowWrite = {
      entity: "purchaseOrder",
      action: "delete",
      id: ORDER_ID,
      expectedRowVersion: 1,
    };

    const lineDelete = (expectedRowVersion: number): CatalogRowWrite => ({
      entity: "purchaseOrderItem",
      action: "delete",
      id: ORDER_LINE_ID,
      expectedRowVersion,
    });

    const supplierDelete: CatalogRowWrite = {
      entity: "supplier",
      action: "delete",
      id: SUPPLIER_ID,
      expectedRowVersion: 1,
    };

    it.effect("projects a delivery onto its order line and restores it when rejected", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(placeOrder, 1));
          const receive = purchasing("2", [
            deliveryWrite(),
            orderWrite({ status: "sent", expectedRowVersion: 1 }),
          ]);
          yield* harness.store.enqueueCommand(enqueueRequestOf(receive, 2));

          const line = findRow(yield* harness.rows("purchaseOrderItem"), ORDER_LINE_ID);
          expect(line?.["receivedBaseUnits"]).toBe(15);
          expect(line?.["rowVersion"]).toBe(2);
          const movement = findRow(yield* harness.rows("stockMovement"), DELIVERY_MOVEMENT_ID);
          expect(movement?.["purchaseOrderId"]).toBe(ORDER_ID);
          expect(movement?.["type"]).toBe("stock_in");
          const order = findRow(yield* harness.rows("purchaseOrder"), ORDER_ID);
          expect(order?.["status"]).toBe("sent");
          expect(order?.["orderNumber"]).toBe(1);

          yield* harness.store.claimNextUpload({ claimId: "claim-place", claimedAt: 10 });
          yield* harness.store.settleUploadClaim(
            "claim-place",
            acceptedCatalogReceipt(placeOrder, "10", placeOrderWrites.length),
          );
          yield* harness.store.claimNextUpload({ claimId: "claim-receive", claimedAt: 11 });
          yield* harness.store.settleUploadClaim("claim-receive", rejectedReceipt(receive, "11"));

          const restored = findRow(yield* harness.rows("purchaseOrderItem"), ORDER_LINE_ID);
          expect(restored?.["receivedBaseUnits"]).toBe(0);
          expect(restored?.["rowVersion"]).toBe(1);
          expect(findRow(yield* harness.rows("purchaseOrder"), ORDER_ID)?.["status"]).toBe("draft");
          expect(findRow(yield* harness.rows("batch"), DELIVERY_BATCH_ID)).toBeUndefined();
          expect(
            findRow(yield* harness.rows("stockMovement"), DELIVERY_MOVEMENT_ID),
          ).toBeUndefined();
        }),
      ),
    );

    it.effect("refuses purchasing writes with the code the authority would give", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(placeOrder, 1));
          const draftRefusals: ReadonlyArray<readonly [string, ReadonlyArray<CatalogRowWrite>]> = [
            ["ENTITY_CONFLICT", [supplierWrite({ id: "supplier-twin" })]],
            ["SUPPLIER_HAS_ORDERS", [supplierDelete]],
            [
              "PURCHASE_ORDER_TRANSITION_INVALID",
              [orderWrite({ id: "order-sent", orderNumber: 2, status: "sent" })],
            ],
            [
              "ENTITY_RELATION_INVALID",
              [orderWrite({ id: "order-orphan", orderNumber: 2, supplierId: "supplier-missing" })],
            ],
            [
              "PURCHASE_ORDER_TRANSITION_INVALID",
              [orderWrite({ status: "closed", expectedRowVersion: 1 })],
            ],
            ["ENTITY_CONFLICT", [{ ...orderDelete, expectedRowVersion: 5 }]],
            ["PURCHASE_ORDER_HAS_ITEMS", [orderDelete]],
            [
              "PURCHASE_ORDER_ITEM_QUANTITY_INVALID",
              [orderLineWrite({ id: "line-miscounted", baseUnitQuantity: 20 })],
            ],
            [
              "PURCHASE_ORDER_RECEIPT_PRODUCT_MISMATCH",
              [deliveryWrite({ productId: LAST_UNIT_PRODUCT_ID })],
            ],
            ["INVALID_OPERATION", [deliveryWrite({ expectedRowVersion: 1 })]],
            ["ENTITY_RELATION_INVALID", [deliveryWrite({ lineId: "line-missing" })]],
          ];
          for (const [code, writes] of draftRefusals) {
            expect(yield* refusalOf(harness, writes)).toBe(code);
          }

          yield* harness.store.enqueueCommand(
            enqueueRequestOf(
              purchasing("2", [
                deliveryWrite(),
                orderWrite({ status: "sent", expectedRowVersion: 1 }),
              ]),
              2,
            ),
          );
          expect(yield* refusalOf(harness, [lineDelete(2)])).toBe("PURCHASE_ORDER_ITEM_RECEIVED");
          expect(yield* refusalOf(harness, [{ ...orderDelete, expectedRowVersion: 2 }])).toBe(
            "PURCHASE_ORDER_NOT_DRAFT",
          );

          yield* harness.store.enqueueCommand(
            enqueueRequestOf(
              purchasing("3", [orderWrite({ status: "cancelled", expectedRowVersion: 2 })]),
              3,
            ),
          );
          const closedRefusals: ReadonlyArray<ReadonlyArray<CatalogRowWrite>> = [
            [orderWrite({ status: "sent", expectedRowVersion: 3 })],
            [orderLineWrite({ id: "line-late" })],
            [deliveryWrite({ batchId: "batch-late" })],
          ];
          for (const writes of closedRefusals) {
            expect(yield* refusalOf(harness, writes)).toBe("PURCHASE_ORDER_NOT_OPEN");
          }
          expect(yield* harness.rows("purchaseOrder")).toHaveLength(1);
          expect(yield* harness.rows("purchaseOrderItem")).toHaveLength(1);
        }),
      ),
    );

    it.effect("applies the writes of one command in order", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(placeOrder, 1));
          yield* harness.store.enqueueCommand(
            enqueueRequestOf(purchasing("2", [lineDelete(1), orderDelete, supplierDelete]), 2),
          );
          expect(yield* harness.rows("purchaseOrderItem")).toHaveLength(0);
          expect(yield* harness.rows("purchaseOrder")).toHaveLength(0);
          expect(yield* harness.rows("supplier")).toHaveLength(0);
        }),
      ),
    );

    it.effect("gives a new order the next free number when its proposed number is taken", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(placeOrder, 1));
          yield* harness.store.enqueueCommand(
            enqueueRequestOf(
              purchasing("2", [
                orderWrite({ id: "order-2", orderNumber: 1 }),
                orderWrite({ id: "order-3", orderNumber: 7 }),
                orderWrite({ id: "order-4", orderNumber: 7 }),
              ]),
              2,
            ),
          );
          const orders = yield* harness.rows("purchaseOrder");
          expect(
            ["order-2", "order-3", "order-4"].map((id) => findRow(orders, id)?.["orderNumber"]),
          ).toEqual([2, 7, 8]);
        }),
      ),
    );

    const remotePurchasingRows: SnapshotPartPayload["rows"] = [
      {
        entity: "supplier",
        entityId: "remote-supplier",
        rowVersion: 1,
        row: {
          id: "remote-supplier",
          name: SUPPLIER_NAME,
          phone: null,
          note: null,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: "user-2",
          updatedByUserId: "user-2",
          deviceId: "replica-b",
          operationId: "remote-purchasing-op",
          rowVersion: 1,
        },
      },
      {
        entity: "purchaseOrder",
        entityId: "remote-order",
        rowVersion: 1,
        row: {
          id: "remote-order",
          orderNumber: 1,
          supplierId: "remote-supplier",
          status: "sent",
          note: null,
          sentAt: FIXTURE_NOW,
          expectedAt: null,
          total: 0,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: "user-2",
          updatedByUserId: "user-2",
          deviceId: "replica-b",
          operationId: "remote-purchasing-op",
          rowVersion: 1,
        },
      },
    ];

    const expectDisplacedShadows = (harness: Harness) =>
      Effect.gen(function* () {
        const suppliers = yield* harness.rows("supplier");
        const orders = yield* harness.rows("purchaseOrder");
        expect(findRow(suppliers, "remote-supplier")?.["name"]).toBe(SUPPLIER_NAME);
        expect(findRow(suppliers, SUPPLIER_ID)?.["name"]).toBe(`${SUPPLIER_NAME} (2)`);
        expect(findRow(orders, "remote-order")?.["orderNumber"]).toBe(1);
        expect(findRow(orders, ORDER_ID)?.["orderNumber"]).toBe(2);
      });

    it.effect("moves supplier and order shadows aside before writing the remote rows", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(enqueueRequestOf(placeOrder, 1));
          const applied = yield* harness.store.applyTransactionGroup({
            commitSequence: OrgCommitSequence.make("8"),
            operationId: "remote-purchasing-op",
            decision: "accepted",
            changes: remotePurchasingRows.map((row) => ({ ...row, action: "upsert" as const })),
          });
          yield* expectDisplacedShadows(harness);
          expect(applied.notice?.touchedKeys).toEqual(
            expect.arrayContaining([`supplier:${SUPPLIER_ID}`, `purchaseOrder:${ORDER_ID}`]),
          );
        }),
      ),
    );

    it.effect(
      "moves supplier and order shadows aside when snapshot activation re-applies them",
      () =>
        withHarness((harness) =>
          Effect.gen(function* () {
            yield* harness.store.enqueueCommand(enqueueRequestOf(placeOrder, 1));
            yield* Effect.scoped(harness.store.beginSnapshotImport(snapshotManifest));
            yield* harness.store.importSnapshotPart(snapshotManifest, {
              ...snapshotPart,
              rows: [...snapshotPart.rows, ...remotePurchasingRows],
            });
            yield* harness.store.activateSnapshot(snapshotManifest.snapshotId);
            yield* expectDisplacedShadows(harness);
            expect(findRow(yield* harness.rows("purchaseOrderItem"), ORDER_LINE_ID)).toBeDefined();
            const marks = yield* harness.store.readPendingMarks();
            expect(
              marks.filter((mark) => mark.operationId === placeOrder.operationId),
            ).toHaveLength(placeOrderWrites.length);
          }),
        ),
    );
  });
}
