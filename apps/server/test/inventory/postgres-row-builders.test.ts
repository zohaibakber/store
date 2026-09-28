import * as PgClient from "@effect/sql-pg/PgClient";
import {
  CATALOG_PARTITION_DIGEST_VERSION,
  partitionDigestOf,
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
  stockMovements,
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

const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

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

const RowText = Schema.Struct({ id: Schema.String, json: Schema.String, jsonb: Schema.String });
const decodeRowTexts = Schema.decodeUnknownSync(Schema.Array(RowText));
const DigestRow = Schema.Struct({ digest: Schema.fromJsonString(PartitionDigestReport) });
const decodeDigestRows = Schema.decodeUnknownSync(Schema.Array(DigestRow));

const seed = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* PgDrizzle.makeWithDefaults();
    const insertedCategories = [];
    const insertedProducts = [];
    const insertedBatches = [];
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
      yield* db.insert(stockMovements).values({
        id: `movement ${index} ${text}`,
        productId: `product ${index} ${text}`,
        batchId: `batch ${index} ${text}`,
        invoiceId: `invoice ${index} ${text}`,
        type: "sale",
        packDelta: 0,
        unitDelta: -1,
        note: text,
        organizationId,
        actorUserId: "user-1",
        deviceId: `device-${text}`,
        operationId: `operation-${index}`,
        createdAt: 1_700_000_000_000,
      });
    }
    return {
      db,
      categories: insertedCategories.flatMap((row) => (row ? [row] : [])),
      products: insertedProducts.flatMap((row) => (row ? [row] : [])),
      batches: insertedBatches.flatMap((row) => (row ? [row] : [])),
    };
  });

const byId = <Row extends { readonly id: string }>(rows: ReadonlyArray<Row>) =>
  new Map(rows.map((row) => [row.id, row]));

describe("sync row builders and partition digests", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("builds the exact row JSON that the TypeScript row encoder produces", async () => {
    const organizationId = "org-row-builders";
    const outcome = await run(
      Effect.gen(function* () {
        const seeded = yield* seed(organizationId);
        const categoryTexts = yield* seeded.db.execute(
          sql`select "c"."id", "sync"."category_json"("c")::text as "json", "sync"."category_row"("c")::text as "jsonb" from ${categories} as "c" where "c"."organization_id" = ${organizationId}`,
          "objects",
        );
        const productTexts = yield* seeded.db.execute(
          sql`select "p"."id", "sync"."product_json"("p")::text as "json", "sync"."product_row"("p")::text as "jsonb" from ${products} as "p" where "p"."organization_id" = ${organizationId}`,
          "objects",
        );
        const batchTexts = yield* seeded.db.execute(
          sql`select "b"."id", "sync"."batch_json"("b")::text as "json", "sync"."batch_row"("b")::text as "jsonb" from ${batches} as "b" where "b"."organization_id" = ${organizationId}`,
          "objects",
        );
        const selectedProducts = yield* seeded.db
          .select()
          .from(products)
          .where(eq(products.organizationId, organizationId));
        return {
          seeded,
          selectedProducts,
          categoryTexts: decodeRowTexts(categoryTexts),
          productTexts: decodeRowTexts(productTexts),
          batchTexts: decodeRowTexts(batchTexts),
        };
      }),
    );
    const cases = [
      [outcome.categoryTexts, byId(outcome.seeded.categories)],
      [outcome.productTexts, byId(outcome.seeded.products)],
      [outcome.batchTexts, byId(outcome.seeded.batches)],
      [outcome.productTexts, byId(outcome.selectedProducts)],
    ] as const;
    for (const [texts, rows] of cases) {
      expect(texts).toHaveLength(ADVERSARIAL_TEXT.length);
      for (const text of texts) {
        const row = rows.get(text.id);
        expect(row).toBeDefined();
        expect(text.json).toBe(encodeRowJson(row));
        expect(decodeJson(text.jsonb)).toStrictEqual(decodeJson(encodeRowJson(row)));
      }
    }
  });

  it("computes the same partition digests in Postgres as the shared client contract", async () => {
    const organizationId = "org-digest-v3";
    const outcome = await run(
      Effect.gen(function* () {
        const seeded = yield* seed(organizationId);
        const digestOf = (statement: ReturnType<typeof sql>) =>
          seeded.db
            .execute(statement, "objects")
            .pipe(Effect.map((rows) => decodeDigestRows(rows)[0]?.digest));
        const history = yield* digestOf(
          sql`select "sync"."partition_digest"(${organizationId}, 3)::text as "digest"`,
        );
        const catalog = yield* digestOf(
          sql`select "sync"."partition_digest"(${organizationId}, 2)::text as "digest"`,
        );
        const legacy = yield* digestOf(
          sql`select "sync"."partition_digest"(${organizationId})::text as "digest"`,
        );
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
        ];
        const empty = yield* digestOf(
          sql`select "sync"."partition_digest"(${"org-without-rows"}, 3)::text as "digest"`,
        );
        const emptyCatalog = yield* digestOf(
          sql`select "sync"."partition_digest"(${"org-without-rows"})::text as "digest"`,
        );
        return {
          history,
          catalog,
          legacy,
          clientHistory: yield* partitionDigestOf(sources),
          clientCatalog: yield* partitionDigestOf(sources, CATALOG_PARTITION_DIGEST_VERSION),
          empty,
          emptyClient: yield* partitionDigestOf([]),
          emptyCatalog,
          emptyCatalogClient: yield* partitionDigestOf([], CATALOG_PARTITION_DIGEST_VERSION),
        };
      }),
    );
    expect(outcome.history).toEqual(outcome.clientHistory);
    expect(outcome.clientHistory.count).toBe(ADVERSARIAL_TEXT.length * 6 - 2);
    expect(outcome.catalog).toEqual(outcome.clientCatalog);
    expect(outcome.legacy).toEqual(outcome.clientCatalog);
    expect(outcome.clientCatalog.count).toBe(ADVERSARIAL_TEXT.length * 3 - 2);
    expect(outcome.empty).toEqual(outcome.emptyClient);
    expect(outcome.emptyCatalog).toEqual(outcome.emptyCatalogClient);
  });
});
