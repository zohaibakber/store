import {
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  partitionDigestOf,
  SnapshotPartPayload,
  SYNC_SCHEMA_VERSION,
  type SnapshotRow,
} from "@store/contracts";
import { LAST_UNIT_EPOCH, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import {
  authorityState,
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  replicas,
  stockMovements,
} from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { describe, expect, it } from "vitest";

import { partitionDigest } from "../../src/authority/digest";
import { makeAuthorityEngine } from "../../src/authority/engine";
import { SNAPSHOT_POLICY } from "../../src/authority/policy";
import { makeAuthoritySnapshots } from "../../src/authority/snapshots";
import type { InventoryActor } from "../../src/inventory/model";
import { makeTestAuthorities } from "./harness";

const decodePart = Schema.decodeUnknownSync(Schema.fromJsonString(SnapshotPartPayload));

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

const pad = (value: number) => String(value).padStart(6, "0");

const seed = (
  db: ReplicaDb,
  organizationId: string,
  history: { readonly invoices: number; readonly itemsPerInvoice: number },
) =>
  Effect.gen(function* () {
    const meta = {
      organizationId,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: LAST_UNIT_REPLICA_A,
    };
    yield* db.insert(authorityState).values({
      id: 1,
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: 2,
      retentionFloor: 0,
      createdAt: 1,
    });
    yield* db.insert(replicas).values({
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: "user-1",
      deviceLabel: "desk",
      lastClientSequence: 0,
      processedThroughClientSequence: 0,
      registeredAt: 1,
      lastSeenAt: 1,
    });
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      createdAt: 1,
      updatedAt: 1,
      operationId: "seed-category",
      rowVersion: 1,
      ...meta,
    });
    for (let p = 1; p <= 3; p += 1) {
      yield* db.insert(products).values({
        id: `product-${p}`,
        name: `Product ${p}`,
        categoryId: "general",
        createdAt: 1,
        updatedAt: 1,
        operationId: "seed-product",
        rowVersion: p,
        ...meta,
      });
      yield* db.insert(batches).values({
        id: `batch-${p}`,
        productId: `product-${p}`,
        batchNumber: `B-${p}`,
        packQuantity: 0,
        unitQuantity: 1000,
        createdAt: 1,
        updatedAt: 1,
        operationId: "seed-batch",
        rowVersion: 1,
        ...meta,
      });
    }
    for (let g = 1; g <= history.invoices; g += 1) {
      const at = 1_700_000_000_000 + g;
      yield* db.insert(invoices).values({
        id: `inv-${pad(g)}`,
        invoiceNumber: g,
        customerName: g % 2 === 0 ? `Customer "${g}"` : null,
        total: 100 * g,
        createdAt: at,
        updatedAt: at,
        operationId: `sale-${g}`,
        rowVersion: 1,
        ...meta,
      });
      for (let k = 1; k <= history.itemsPerInvoice; k += 1) {
        const product = 1 + (k % 3);
        yield* db.insert(invoiceItems).values({
          id: `item-${pad(g)}-${k}`,
          invoiceId: `inv-${pad(g)}`,
          productId: `product-${product}`,
          batchId: `batch-${product}`,
          productName: `Product ${product}`,
          batchNumber: `B-${product}`,
          quantity: 1,
          quantityType: "unit",
          baseUnitQuantity: 1,
          salePrice: 100,
          createdAt: at,
          updatedAt: at,
          operationId: `sale-${g}`,
          rowVersion: 1,
          ...meta,
        });
        yield* db.insert(stockMovements).values({
          id: `move-${pad(g)}-${k}`,
          productId: `product-${product}`,
          batchId: `batch-${product}`,
          invoiceId: `inv-${pad(g)}`,
          type: "sale",
          packDelta: 0,
          unitDelta: -1,
          note: null,
          organizationId,
          actorUserId: "user-1",
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: `sale-${g}`,
          createdAt: at,
        });
      }
    }
  });

const leavesOf = (rows: ReadonlyArray<SnapshotRow>) =>
  rows.map((row) => ({ entity: row.entity, entityId: row.entityId, rowVersion: row.rowVersion }));

describe("durable object history snapshots", () => {
  it("serves catalog and history in one snapshot that matches the partition digest", async () => {
    const organizationId = "org-history-views";
    const actor: InventoryActor = { organizationId, userId: "user-1" };
    const outcome = await run(
      Effect.gen(function* () {
        const authorities = makeTestAuthorities();
        const { db, sql } = yield* authorities.open(organizationId);
        yield* seed(db, organizationId, { invoices: 40, itemsPerInvoice: 2 }).pipe(Effect.orDie);
        const engine = makeAuthorityEngine(sql, db);
        let minted = 0;
        const snapshots = makeAuthoritySnapshots(
          engine,
          db,
          Effect.sync(() => `snapshot${(minted += 1)}`),
        );
        const acquired = yield* snapshots.acquire(
          actor,
          {
            epoch: LAST_UNIT_EPOCH,
            subscription: OPERATIONAL_SUBSCRIPTION,
            replicaId: LAST_UNIT_REPLICA_A,
          },
          SYNC_SCHEMA_VERSION,
          1_700_000_100_000,
          { ...SNAPSHOT_POLICY, partRows: 50 },
        );
        const parts = yield* Effect.forEach(acquired.manifest.parts, (part) =>
          snapshots.readPart(actor, acquired.manifest.snapshotId, part.partNumber).pipe(
            Effect.map((encoded) => ({
              sha256: encoded.sha256,
              byteLength: Buffer.byteLength(encoded.json, "utf8"),
              payload: decodePart(encoded.json),
            })),
          ),
        );
        return {
          manifest: acquired.manifest,
          parts,
          digest: yield* partitionDigest(db),
        };
      }).pipe(Effect.orDie),
    );
    expect(outcome.manifest.digestVersion).toBe(PARTITION_DIGEST_VERSION);
    expect(outcome.manifest.horizon).toBe("2");
    expect(outcome.manifest.parts.map((part) => part.objectKey)).toEqual(
      outcome.manifest.parts.map(
        (part) => `${organizationId}/${outcome.manifest.snapshotId}/${part.partNumber}`,
      ),
    );
    expect(outcome.parts.map(({ sha256, byteLength }) => ({ sha256, byteLength }))).toEqual(
      outcome.manifest.parts.map(({ sha256, byteLength }) => ({ sha256, byteLength })),
    );
    expect(outcome.manifest.entityCounts).toEqual([
      { entity: "category", rowCount: 1 },
      { entity: "product", rowCount: 3 },
      { entity: "batch", rowCount: 3 },
      { entity: "invoice", rowCount: 40 },
      { entity: "invoiceItem", rowCount: 80 },
      { entity: "stockMovement", rowCount: 80 },
      { entity: "supplier", rowCount: 0 },
      { entity: "purchaseOrder", rowCount: 0 },
      { entity: "purchaseOrderItem", rowCount: 0 },
    ]);
    const rows = outcome.parts.flatMap((part) => part.payload.rows);
    expect(rows.map((row) => row.entity)).toEqual([
      "category",
      ...Array.from({ length: 3 }, () => "product"),
      ...Array.from({ length: 3 }, () => "batch"),
      ...Array.from({ length: 40 }, () => "invoice"),
      ...Array.from({ length: 80 }, () => "invoiceItem"),
      ...Array.from({ length: 80 }, () => "stockMovement"),
    ]);
    expect(
      rows.filter((row) => row.entity === "stockMovement").map((row) => row.rowVersion),
    ).toEqual(Array.from({ length: 80 }, () => 1));
    for (const part of outcome.parts) expect(part.payload.rows.length).toBeLessThanOrEqual(50);
    expect(await Effect.runPromise(partitionDigestOf(leavesOf(rows)))).toEqual(outcome.digest);
  });
});
