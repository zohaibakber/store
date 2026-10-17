import {
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION_V3,
  PARTITION_ENTITIES_V3,
  partitionDigestOf,
  PURCHASE_ORDER_STATUSES,
  SnapshotPartPayload,
  STOCK_MOVEMENT_ROW_VERSION,
  SyncEpoch,
  type PartitionLeafSource,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import {
  authorityState,
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
} from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { describe, expect, it } from "vitest";

import { partitionDigest } from "../../src/authority/digest";
import { makeInventorySnapshots } from "../../src/inventory/snapshots";
import { makeTestAuthorities } from "./harness";

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

const decodePart = Schema.decodeUnknownSync(Schema.fromJsonString(SnapshotPartPayload));

const ADVERSARIAL_TEXT = [
  "plain",
  'quote " inside',
  "back\\slash\\\\double",
  "line\nbreak\r\ttab",
  "control \u0001\u0008\u000c\u001f\u007f",
  "unicode é 日本 😀   ",
  "slash / and </script>",
  "",
] as const;

const SKIPPED_PRODUCT = 3;

const SKIPPED_BATCH = 5;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const metadata = (organizationId: string, index: number, rowVersion: number) => ({
  organizationId,
  createdByUserId: `user "${index}"`,
  updatedByUserId: "user\\2",
  deviceId: `device-${ADVERSARIAL_TEXT[index % ADVERSARIAL_TEXT.length]}`,
  operationId: `operation-${index}`,
  rowVersion,
});

const seed = (db: ReplicaDb, organizationId: string) =>
  Effect.gen(function* () {
    const sources: Array<PartitionLeafSource> = [];
    yield* db.insert(authorityState).values({
      id: 1,
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: 0,
      retentionFloor: 0,
      createdAt: 1,
    });
    for (const [index, text] of ADVERSARIAL_TEXT.entries()) {
      const categoryId = `category ${index} ${text}`;
      yield* db.insert(categories).values({
        id: categoryId,
        name: `Name ${index} ${text}`,
        tracksPacks: index % 2 === 0,
        createdAt: index === 0 ? 0 : MAX_SAFE - index,
        updatedAt: MAX_SAFE,
        ...metadata(organizationId, index, index + 1),
      });
      sources.push({ entity: "category", entityId: categoryId, rowVersion: index + 1 });
      if (index !== SKIPPED_PRODUCT) {
        const productId = `product ${index} ${text}`;
        yield* db.insert(products).values({
          id: productId,
          name: `Product ${text || "blank"}`,
          categoryId,
          aisle: index % 3 === 0 ? null : text,
          composition: index % 2 === 0 ? text : null,
          strength: null,
          unitsPerPack: 2_147_483_647 - index,
          purchasePrice: index % 2 === 0 ? null : 0,
          retailPrice: 2_147_483_647,
          unitPrice: index,
          visible: index % 2 === 1,
          createdAt: 1,
          updatedAt: MAX_SAFE - 1,
          ...metadata(organizationId, index, MAX_SAFE - index),
        });
        sources.push({ entity: "product", entityId: productId, rowVersion: MAX_SAFE - index });
      }
      if (index !== SKIPPED_BATCH) {
        const batchId = `batch ${index} ${text}`;
        yield* db.insert(batches).values({
          id: batchId,
          productId: `product ${index} ${text}`,
          batchNumber: index % 2 === 0 ? null : text,
          expiresAt: index % 2 === 0 ? null : MAX_SAFE - index,
          packQuantity: index,
          unitQuantity: 2_147_483_647,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000 + index,
          ...metadata(organizationId, index, index + 7),
        });
        sources.push({ entity: "batch", entityId: batchId, rowVersion: index + 7 });
      }
      yield* db.insert(invoices).values({
        id: `invoice ${index} ${text}`,
        invoiceNumber: index + 1,
        customerName: index % 2 === 0 ? null : text,
        total: index * 100,
        createdAt: 1_700_000_000_000 + index,
        updatedAt: 1_700_000_000_000 + index,
        ...metadata(organizationId, index, index + 3),
      });
      sources.push({
        entity: "invoice",
        entityId: `invoice ${index} ${text}`,
        rowVersion: index + 3,
      });
      yield* db.insert(invoiceItems).values({
        id: `item ${index} ${text}`,
        invoiceId: `invoice ${index} ${text}`,
        productId: `product ${index} ${text}`,
        batchId: `batch ${index} ${text}`,
        productName: `Product ${text || "blank"}`,
        batchNumber: index % 2 === 0 ? null : text,
        quantity: 1,
        quantityType: "unit",
        baseUnitQuantity: 1,
        salePrice: 100,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        ...metadata(organizationId, index, MAX_SAFE - 2 * index),
      });
      sources.push({
        entity: "invoiceItem",
        entityId: `item ${index} ${text}`,
        rowVersion: MAX_SAFE - 2 * index,
      });
      yield* db.insert(suppliers).values({
        id: `supplier ${index} ${text}`,
        name: `Supplier ${index} ${text}`,
        phone: index % 2 === 0 ? null : `92300${index}`,
        note: index % 3 === 0 ? null : text,
        createdAt: 1,
        updatedAt: MAX_SAFE - index,
        ...metadata(organizationId, index, index + 11),
      });
      sources.push({
        entity: "supplier",
        entityId: `supplier ${index} ${text}`,
        rowVersion: index + 11,
      });
      yield* db.insert(purchaseOrders).values({
        id: `order ${index} ${text}`,
        orderNumber: 2_147_483_647 - index,
        supplierId: `supplier ${index} ${text}`,
        status: PURCHASE_ORDER_STATUSES[index % PURCHASE_ORDER_STATUSES.length] ?? "draft",
        note: index % 2 === 0 ? text : null,
        sentAt: index % 2 === 0 ? null : MAX_SAFE - index,
        expectedAt: index % 3 === 0 ? 1 : null,
        total: index === 0 ? 0 : 2_147_483_647,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000 + index,
        ...metadata(organizationId, index, MAX_SAFE - 3 * index),
      });
      sources.push({
        entity: "purchaseOrder",
        entityId: `order ${index} ${text}`,
        rowVersion: MAX_SAFE - 3 * index,
      });
      yield* db.insert(purchaseOrderItems).values({
        id: `line ${index} ${text}`,
        purchaseOrderId: `order ${index} ${text}`,
        productId: `product ${index} ${text}`,
        productName: `Product ${text || "blank"}`,
        quantity: index + 1,
        quantityType: index % 2 === 0 ? "pack" : "unit",
        baseUnitQuantity: 2_147_483_647,
        packCost: index % 2 === 0 ? null : index,
        receivedBaseUnits: index,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        ...metadata(organizationId, index, index + 5),
      });
      sources.push({
        entity: "purchaseOrderItem",
        entityId: `line ${index} ${text}`,
        rowVersion: index + 5,
      });
      yield* db.insert(stockMovements).values({
        id: `movement ${index} ${text}`,
        productId: `product ${index} ${text}`,
        batchId: `batch ${index} ${text}`,
        invoiceId: index % 2 === 0 ? `invoice ${index} ${text}` : null,
        purchaseOrderId: index % 2 === 0 ? null : `order ${index} ${text}`,
        type: index % 2 === 0 ? "sale" : "stock_in",
        packDelta: 0,
        unitDelta: index % 2 === 0 ? -1 : 1,
        note: text,
        organizationId,
        actorUserId: "user-1",
        deviceId: `device-${text}`,
        operationId: `operation-${index}`,
        createdAt: 1_700_000_000_000,
      });
      sources.push({
        entity: "stockMovement",
        entityId: `movement ${index} ${text}`,
        rowVersion: STOCK_MOVEMENT_ROW_VERSION,
      });
    }
    return sources;
  });

describe("durable object row builders and partition digests", () => {
  it("computes the same partition digests as the shared client contract", async () => {
    const organizationId = "org-digest-v4";
    const outcome = await run(
      Effect.gen(function* () {
        const authorities = makeTestAuthorities();
        const { db } = yield* authorities.open(organizationId);
        const sources = yield* seed(db, organizationId);
        const empty = yield* authorities.open("org-without-rows");
        return {
          history: yield* partitionDigest(db, PARTITION_DIGEST_VERSION),
          legacy: yield* partitionDigest(db, PARTITION_DIGEST_VERSION_V3),
          clientHistory: yield* partitionDigestOf(sources),
          empty: yield* partitionDigest(empty.db, PARTITION_DIGEST_VERSION),
          emptyClient: yield* partitionDigestOf([]),
        };
      }).pipe(Effect.orDie),
    );
    expect(outcome.history).toEqual(outcome.clientHistory);
    expect(outcome.clientHistory.count).toBe(ADVERSARIAL_TEXT.length * 9 - 2);
    expect(outcome.empty).toEqual(outcome.emptyClient);
    expect(outcome.legacy.version).toBe(PARTITION_DIGEST_VERSION_V3);
    expect(new Set(Object.keys(outcome.legacy.entities))).toEqual(new Set(PARTITION_ENTITIES_V3));
    expect(outcome.legacy.digest).not.toBe(outcome.history.digest);
  });

  it("serves snapshot rows that decode to the stored rows and hash to the authority digest", async () => {
    const organizationId = "org-snapshot-rows";
    const actor = { organizationId, userId: "user-1" };
    const outcome = await run(
      Effect.gen(function* () {
        const authorities = makeTestAuthorities();
        const { db } = yield* authorities.open(organizationId);
        yield* seed(db, organizationId);
        const snapshots = makeInventorySnapshots(authorities);
        const { manifest } = yield* snapshots.acquireSnapshot(actor, {
          epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
          subscription: OPERATIONAL_SUBSCRIPTION,
        });
        const parts = yield* Effect.forEach(manifest.parts, (part) =>
          snapshots.readSnapshotPartEncoded(actor, manifest.snapshotId, part.partNumber),
        );
        const stored = {
          category: yield* db.select().from(categories).all(),
          product: yield* db.select().from(products).all(),
          batch: yield* db.select().from(batches).all(),
          invoice: yield* db.select().from(invoices).all(),
          invoiceItem: yield* db.select().from(invoiceItems).all(),
          stockMovement: yield* db.select().from(stockMovements).all(),
          supplier: yield* db.select().from(suppliers).all(),
          purchaseOrder: yield* db.select().from(purchaseOrders).all(),
          purchaseOrderItem: yield* db.select().from(purchaseOrderItems).all(),
        };
        return {
          manifest,
          rows: parts.flatMap((part) => decodePart(part.json).rows),
          stored,
          digest: yield* partitionDigest(db, PARTITION_DIGEST_VERSION),
        };
      }).pipe(Effect.orDie),
    );
    expect(outcome.manifest.digestVersion).toBe(PARTITION_DIGEST_VERSION);
    expect(outcome.rows).toHaveLength(ADVERSARIAL_TEXT.length * 9 - 2);
    for (const row of outcome.rows) {
      const decodeStored = Schema.decodeUnknownSync(syncEntityRows[row.entity].schema);
      const original = outcome.stored[row.entity].find(
        (candidate) => candidate.id === row.entityId,
      );
      expect(original, `${row.entity} ${row.entityId}`).toBeDefined();
      expect(decodeStored(row.row)).toEqual(decodeStored(original));
    }
    expect(
      await Effect.runPromise(
        partitionDigestOf(
          outcome.rows.map((row) => ({
            entity: row.entity,
            entityId: row.entityId,
            rowVersion: row.rowVersion,
          })),
        ),
      ),
    ).toEqual(outcome.digest);
  });
});
