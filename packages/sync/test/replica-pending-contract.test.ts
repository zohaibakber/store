import { describe, expect, it } from "@effect/vitest";
import {
  OrgCommitSequence,
  ReplicaClientSequence,
  SnapshotId,
  SnapshotPartHash,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncCommandEnvelope,
  type SyncEntity,
  type SyncTransactionGroup,
} from "@store/contracts";
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
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
  stockOverlays,
} from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { IndexedDbEntityTable, IndexedDbSubsetRow } from "../src/replica/indexeddb/query";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction } from "../src/replica/storage";
import type { ReplicaStoreContract } from "../src/replica/store";
import {
  catalogEnvelope,
  deleteSpareBatchWrite,
  FIXTURE_NOW,
  insertCategoryWrite,
  NEW_CATEGORY_ID,
  rejectedReceipt,
  renameProductWrite,
  restockBatchWrite,
  seedCatalogGroup,
  seedSpareBatchGroup,
  SPARE_BATCH_ID,
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

const sqliteTables = {
  category: categories,
  product: products,
  batch: batches,
  invoice: invoices,
  invoiceItem: invoiceItems,
  stockMovement: stockMovements,
} as const;

const indexedTables = {
  category: "categories",
  product: "products",
  batch: "batches",
  invoice: "invoices",
  invoiceItem: "invoice_items",
  stockMovement: "stock_movements",
} as const satisfies Record<SyncEntity, IndexedDbEntityTable>;

const makeSqliteHarness = Effect.fn("harness.sqlite")(function* () {
  const scope = yield* Scope.make();
  const handle = yield* Scope.provide(seedReplicaTenUnits(), scope);
  const store = yield* makeSqliteReplicaStore(handle, "sqlite-pending");
  yield* store.applyTransactionGroup(seedSpareBatchGroup);
  return {
    store,
    rows: (entity: SyncEntity) =>
      runReplicaTransaction(handle, (tx) => tx.select().from(sqliteTables[entity]).all()).pipe(
        Effect.map((rows) => rows.map((row) => decodeEntityRow(row))),
      ),
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
          table: indexedTables[entity],
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
      objectKey: "parts/1",
      byteLength: 1,
      sha256: SnapshotPartHash.make("b".repeat(64)),
    },
  ],
  entityCounts: [{ entity: "batch", rowCount: 1 }],
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
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
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
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
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
          yield* harness.store.enqueueCommand(envelope, 1);
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
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
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
          yield* harness.store.enqueueCommand(envelope, 1);
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

    it.effect("lets a remote change win over a shadowed row", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = catalogEnvelope({
            operationId: "catalog-2",
            clientSequence: "1",
            writes: [renameProductWrite("Local name")],
          });
          yield* harness.store.enqueueCommand(envelope, 1);
          yield* harness.store.applyTransactionGroup(remoteProductGroup);
          const productRows = yield* harness.rows("product");
          const marks = yield* harness.store.readPendingMarks();
          expect(findRow(productRows, LAST_UNIT_PRODUCT_ID)?.["name"]).toBe("Remote name");
          expect(marks.filter((mark) => mark.entity === "product")).toHaveLength(0);
        }),
      ),
    );

    it.effect("shadows catalog inserts, updates, and deletes", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const envelope = catalogEnvelope({
            operationId: "catalog-3",
            clientSequence: "1",
            writes: [insertCategoryWrite, renameProductWrite("Edited"), deleteSpareBatchWrite],
          });
          yield* harness.store.enqueueCommand(envelope, 1);
          const categoryRows = yield* harness.rows("category");
          const productRows = yield* harness.rows("product");
          const batchRows = yield* harness.rows("batch");
          const marks = yield* harness.store.readPendingMarks();
          expect(findRow(categoryRows, NEW_CATEGORY_ID)?.["name"]).toBe("Cold chain");
          expect(findRow(productRows, LAST_UNIT_PRODUCT_ID)?.["name"]).toBe("Edited");
          expect(findRow(batchRows, SPARE_BATCH_ID)).toBeUndefined();
          expect(marks).toHaveLength(3);
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
          yield* harness.store.enqueueCommand(envelope, 1);
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
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
          yield* harness.store.beginSnapshotImport(snapshotManifest);
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
          const failure = yield* Effect.flip(harness.store.enqueueCommand(envelope, 1));
          expect(failure._tag).toBe("SyncProtocolError");
          const invoiceRows = yield* harness.rows("invoice");
          expect(invoiceRows).toHaveLength(0);
        }),
      ),
    );

    it.effect("produces no duplicate shadow rows on idempotent replay", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
          const replay = yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 2);
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
          yield* harness.store.enqueueCommand(envelope, 1);
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
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
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
          yield* harness.store.enqueueCommand(firstRename, 1);
          yield* harness.store.enqueueCommand(secondRename, 2);
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
          yield* harness.store.enqueueCommand(firstRename, 1);
          yield* harness.store.enqueueCommand(secondRename, 2);
          yield* harness.store.applyTransactionGroup(remoteProductGroup);
          expect(yield* productName(harness)).toBe("Remote name");

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
          yield* harness.store.enqueueCommand(firstRename, 1);
          yield* harness.store.enqueueCommand(secondRename, 2);
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
          yield* harness.store.beginSnapshotImport(snapshotManifest);
          yield* harness.store.importSnapshotPart(snapshotManifest, snapshotPart);
          yield* harness.store.activateSnapshot(snapshotManifest.snapshotId);
          const batchRows = yield* harness.rows("batch");
          expect(findRow(batchRows, SPARE_BATCH_ID)).toBeUndefined();
          expect(findRow(batchRows, LAST_UNIT_BATCH_ID)).toBeDefined();
        }),
      ),
    );

    it.effect("keeps invoices, items, and movements through snapshot recovery", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
          const invoiceGroup = authoritativeInvoiceGroup({
            operationId: lastUnitBuyerAEnvelope.operationId,
            commitSequence: "5",
            invoiceNumber: 7,
          });
          yield* harness.store.applyTransactionGroup(invoiceGroup);
          const before = {
            invoices: yield* harness.rows("invoice"),
            items: yield* harness.rows("invoiceItem"),
            movements: yield* harness.rows("stockMovement"),
          };
          expect(before.invoices).toHaveLength(1);
          expect(before.items).toHaveLength(1);
          expect(before.movements).toHaveLength(1);

          yield* harness.store.beginSnapshotImport(snapshotManifest);
          yield* harness.store.importSnapshotPart(snapshotManifest, snapshotPart);
          yield* harness.store.activateSnapshot(snapshotManifest.snapshotId);

          expect(yield* harness.rows("invoice")).toEqual(before.invoices);
          expect(yield* harness.rows("invoiceItem")).toEqual(before.items);
          expect(yield* harness.rows("stockMovement")).toEqual(before.movements);
        }),
      ),
    );

    it.effect("renames a colliding category shadow when snapshot activation re-applies it", () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          yield* harness.store.enqueueCommand(
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
          yield* harness.store.beginSnapshotImport(snapshotManifest);
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
          yield* harness.store.enqueueCommand(envelope, 1);
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
  });
}
