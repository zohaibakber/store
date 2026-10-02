import * as PgClient from "@effect/sql-pg/PgClient";
import {
  PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION_V3,
  PARTITION_ENTITIES_V3,
  partitionDigestOf,
  PURCHASE_ORDER_STATUSES,
  PartitionDigestReport,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionLeafSource,
} from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
} from "@store/db/postgres/schema";
import { eq, sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

let database: AuthorityPostgres;

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        PgClient.layer({
          url: Redacted.make(database.connectionString),
          maxConnections: 2,
          applicationName: "tabaaq-row-builder-tests",
        }),
      ),
      Effect.scoped,
    ),
  );

const ADVERSARIAL_TEXT = [
  "plain",
  'quote " inside',
  "back\\slash\\\\double",
  "line\nbreak\r\ttab",
  "control \u0001\u0008\u000c\u001f\u007f",
  "unicode é 日本 😀   ",
  "slash / and </script>",
  "",
] as const;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const metadata = (organizationId: string, index: number, rowVersion: number) => ({
  organizationId,
  createdByUserId: `user "${index}"`,
  updatedByUserId: "user\\2",
  deviceId: `device-${ADVERSARIAL_TEXT[index % ADVERSARIAL_TEXT.length]}`,
  operationId: `operation-${index}`,
  rowVersion,
});

const DigestRow = Schema.Struct({ digest: Schema.fromJsonString(PartitionDigestReport) });
const decodeDigestRows = Schema.decodeUnknownSync(Schema.Array(DigestRow));
const LegacyDigest = Schema.Struct({
  version: Schema.Literal(PARTITION_DIGEST_VERSION_V3),
  entities: Schema.Record(Schema.String, Schema.String),
});
const LegacyDigestRow = Schema.Struct({
  current: Schema.String,
  requested: Schema.String,
  digest: Schema.fromJsonString(LegacyDigest),
});
const decodeLegacyDigestRows = Schema.decodeUnknownSync(Schema.Array(LegacyDigestRow));

const seed = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* PgDrizzle.makeWithDefaults();
    const insertedCategories = [];
    const insertedProducts = [];
    const insertedBatches = [];
    const insertedSuppliers = [];
    const insertedOrders = [];
    const insertedLines = [];
    const insertedMovements = [];
    for (const [index, text] of ADVERSARIAL_TEXT.entries()) {
      const categoryId = `category ${index} ${text}`;
      const [category] = yield* db
        .insert(categories)
        .values({
          id: categoryId,
          name: `Name ${index} ${text}`,
          tracksPacks: index % 2 === 0,
          createdAt: index === 0 ? 0 : MAX_SAFE - index,
          updatedAt: MAX_SAFE,
          ...metadata(organizationId, index, index + 1),
        })
        .returning();
      insertedCategories.push(category);
      const [product] = yield* db
        .insert(products)
        .values({
          id: `product ${index} ${text}`,
          name: `Product ${text}`,
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
          deletedAt: index === 3 ? MAX_SAFE : null,
          ...metadata(organizationId, index, MAX_SAFE - index),
        })
        .returning();
      insertedProducts.push(product);
      const [batch] = yield* db
        .insert(batches)
        .values({
          id: `batch ${index} ${text}`,
          productId: `product ${index} ${text}`,
          batchNumber: index % 2 === 0 ? null : text,
          expiresAt: index % 2 === 0 ? null : MAX_SAFE - index,
          packQuantity: -2_147_483_648 + index,
          unitQuantity: 2_147_483_647,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000 + index,
          deletedAt: index === 5 ? 1 : null,
          ...metadata(organizationId, index, index + 7),
        })
        .returning();
      insertedBatches.push(batch);
      yield* db.insert(invoices).values({
        id: `invoice ${index} ${text}`,
        invoiceNumber: index + 1,
        customerName: index % 2 === 0 ? null : text,
        total: index * 100,
        createdAt: 1_700_000_000_000 + index,
        updatedAt: 1_700_000_000_000 + index,
        ...metadata(organizationId, index, index + 3),
      });
      yield* db.insert(invoiceItems).values({
        id: `item ${index} ${text}`,
        invoiceId: `invoice ${index} ${text}`,
        productId: `product ${index} ${text}`,
        batchId: `batch ${index} ${text}`,
        productName: `Product ${text}`,
        batchNumber: index % 2 === 0 ? null : text,
        quantity: 1,
        quantityType: "unit",
        baseUnitQuantity: 1,
        salePrice: 100,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        ...metadata(organizationId, index, MAX_SAFE - 2 * index),
      });
      const [supplier] = yield* db
        .insert(suppliers)
        .values({
          id: `supplier ${index} ${text}`,
          name: `Supplier ${index} ${text}`,
          phone: index % 2 === 0 ? null : `92300${index}`,
          note: index % 3 === 0 ? null : text,
          createdAt: 1,
          updatedAt: MAX_SAFE - index,
          ...metadata(organizationId, index, index + 11),
        })
        .returning();
      insertedSuppliers.push(supplier);
      const [order] = yield* db
        .insert(purchaseOrders)
        .values({
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
        })
        .returning();
      insertedOrders.push(order);
      const [line] = yield* db
        .insert(purchaseOrderItems)
        .values({
          id: `line ${index} ${text}`,
          purchaseOrderId: `order ${index} ${text}`,
          productId: `product ${index} ${text}`,
          productName: `Product ${text}`,
          quantity: index + 1,
          quantityType: index % 2 === 0 ? "pack" : "unit",
          baseUnitQuantity: 2_147_483_647,
          packCost: index % 2 === 0 ? null : index,
          receivedBaseUnits: index,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          ...metadata(organizationId, index, index + 5),
        })
        .returning();
      insertedLines.push(line);
      const [movement] = yield* db
        .insert(stockMovements)
        .values({
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
        })
        .returning();
      insertedMovements.push(movement);
    }
    const present = <Row>(rows: ReadonlyArray<Row | undefined>) =>
      rows.flatMap((row) => (row ? [row] : []));
    return {
      db,
      categories: present(insertedCategories),
      products: present(insertedProducts),
      batches: present(insertedBatches),
      suppliers: present(insertedSuppliers),
      orders: present(insertedOrders),
      lines: present(insertedLines),
      movements: present(insertedMovements),
    };
  });

describe("sync row builders and partition digests", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("computes the same partition digests in Postgres as the shared client contract", async () => {
    const organizationId = "org-digest-v4";
    const outcome = await run(
      Effect.gen(function* () {
        const seeded = yield* seed(organizationId);
        const digestOf = (statement: ReturnType<typeof sql>) =>
          seeded.db
            .execute(statement, "objects")
            .pipe(Effect.map((rows) => decodeDigestRows(rows)[0]?.digest));
        const history = yield* digestOf(
          sql`select "sync"."partition_digest"(${organizationId}, ${PARTITION_DIGEST_VERSION}::integer)::text as "digest"`,
        );
        const legacy = yield* seeded.db
          .execute(
            sql`select "sync"."partition_digest"(${organizationId})::text as "current",
              "sync"."partition_digest"(${organizationId}, ${PARTITION_DIGEST_VERSION_V3}::integer)::text as "requested",
              "sync"."partition_digest"(${organizationId})::text as "digest"`,
            "objects",
          )
          .pipe(Effect.map((rows) => decodeLegacyDigestRows(rows)[0]));
        const itemIds = yield* seeded.db
          .select({ id: invoiceItems.id, rowVersion: invoiceItems.rowVersion })
          .from(invoiceItems)
          .where(eq(invoiceItems.organizationId, organizationId));
        const invoiceIds = yield* seeded.db
          .select({ id: invoices.id, rowVersion: invoices.rowVersion })
          .from(invoices)
          .where(eq(invoices.organizationId, organizationId));
        const movementIds = yield* seeded.db
          .select({ id: stockMovements.id })
          .from(stockMovements)
          .where(eq(stockMovements.organizationId, organizationId));
        const sources: ReadonlyArray<PartitionLeafSource> = [
          ...seeded.categories.map((category) => ({
            entity: "category" as const,
            entityId: category.id,
            rowVersion: category.rowVersion,
          })),
          ...seeded.products
            .filter((product) => product.deletedAt === null)
            .map((product) => ({
              entity: "product" as const,
              entityId: product.id,
              rowVersion: product.rowVersion,
            })),
          ...seeded.batches
            .filter((batch) => batch.deletedAt === null)
            .map((batch) => ({
              entity: "batch" as const,
              entityId: batch.id,
              rowVersion: batch.rowVersion,
            })),
          ...invoiceIds.map((row) => ({
            entity: "invoice" as const,
            entityId: row.id,
            rowVersion: row.rowVersion,
          })),
          ...itemIds.map((row) => ({
            entity: "invoiceItem" as const,
            entityId: row.id,
            rowVersion: row.rowVersion,
          })),
          ...movementIds.map((row) => ({
            entity: "stockMovement" as const,
            entityId: row.id,
            rowVersion: STOCK_MOVEMENT_ROW_VERSION,
          })),
          ...seeded.suppliers.map((row) => ({
            entity: "supplier" as const,
            entityId: row.id,
            rowVersion: row.rowVersion,
          })),
          ...seeded.orders.map((row) => ({
            entity: "purchaseOrder" as const,
            entityId: row.id,
            rowVersion: row.rowVersion,
          })),
          ...seeded.lines.map((row) => ({
            entity: "purchaseOrderItem" as const,
            entityId: row.id,
            rowVersion: row.rowVersion,
          })),
        ];
        const empty = yield* digestOf(
          sql`select "sync"."partition_digest"(${"org-without-rows"}, ${PARTITION_DIGEST_VERSION}::integer)::text as "digest"`,
        );
        return {
          legacy,
          history,
          clientHistory: yield* partitionDigestOf(sources),
          empty,
          emptyClient: yield* partitionDigestOf([]),
        };
      }),
    );
    expect(outcome.history).toEqual(outcome.clientHistory);
    expect(outcome.clientHistory.count).toBe(ADVERSARIAL_TEXT.length * 9 - 2);
    expect(outcome.empty).toEqual(outcome.emptyClient);
    expect(outcome.legacy?.requested).toBe(outcome.legacy?.current);
    expect(new Set(Object.keys(outcome.legacy?.digest.entities ?? {}))).toEqual(
      new Set(PARTITION_ENTITIES_V3),
    );
  });
});
