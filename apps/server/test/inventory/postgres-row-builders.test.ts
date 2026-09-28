import * as PgClient from "@effect/sql-pg/PgClient";
import { partitionDigestOf, PartitionDigestReport } from "@store/contracts";
import { batches, categories, products } from "@store/db/postgres/schema";
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

describe("sync row builders and partition digest v2", () => {
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

  it("computes the same partition digest in Postgres as the shared client contract", async () => {
    const organizationId = "org-digest-v2";
    const outcome = await run(
      Effect.gen(function* () {
        const seeded = yield* seed(organizationId);
        const [row] = decodeDigestRows(
          yield* seeded.db.execute(
            sql`select "sync"."partition_digest"(${organizationId})::text as "digest"`,
            "objects",
          ),
        );
        const client = yield* partitionDigestOf([
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
        ]);
        const [empty] = decodeDigestRows(
          yield* seeded.db.execute(
            sql`select "sync"."partition_digest"(${"org-without-rows"})::text as "digest"`,
            "objects",
          ),
        );
        const emptyClient = yield* partitionDigestOf([]);
        return { server: row?.digest, client, empty: empty?.digest, emptyClient };
      }),
    );
    expect(outcome.server).toEqual(outcome.client);
    expect(outcome.client.count).toBe(ADVERSARIAL_TEXT.length * 3 - 2);
    expect(outcome.empty).toEqual(outcome.emptyClient);
  });
});
