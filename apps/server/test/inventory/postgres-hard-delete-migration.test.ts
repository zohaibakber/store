import * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const ORGANIZATION_ID = "org-hard-delete-migration";

let database: AuthorityPostgres;

const metadata = `'${ORGANIZATION_ID}', 'user-1', 'user-1', 'device-1', 'seed'`;

const category = (id: string, name: string, updatedAt: number, deletedAt?: number) =>
  deletedAt === undefined
    ? `INSERT INTO "categories" ("id", "name", "created_at", "updated_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version") VALUES ('${id}', '${name}', 1, ${updatedAt}, ${metadata}, 3)`
    : `INSERT INTO "categories" ("id", "name", "created_at", "updated_at", "deleted_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version") VALUES ('${id}', '${name}', 1, ${updatedAt}, ${deletedAt}, ${metadata}, 3)`;

const product = (id: string, categoryId: string, deletedAt: number | null) =>
  `INSERT INTO "products" ("id", "name", "category_id", "created_at", "updated_at", "deleted_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version") VALUES ('${id}', '${id}', '${categoryId}', 1, 1, ${deletedAt ?? "NULL"}, ${metadata}, 5)`;

const CategoryRows = Schema.Array(
  Schema.Struct({ id: Schema.String, name: Schema.String, rowVersion: Schema.String }),
);
const ProductRows = Schema.Array(
  Schema.Struct({ id: Schema.String, categoryId: Schema.String, rowVersion: Schema.String }),
);

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        PgClient.layer({ url: Redacted.make(database.connectionString), maxConnections: 2 }),
      ),
      Effect.scoped,
    ),
  );

describe("postgres hard delete migration", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres({
      seedBeforeMigration: {
        migration: "20260922180000_hard_deletes",
        seed: async (query) => {
          await query(category("cat-coffee", "Coffee", 1));
          await query(category("cat-tea-live", "Tea", 1));
          await query(category("cat-tea-dead", "Tea", 2, 2));
          await query(category("cat-herbs-old", "Herbs", 1, 3));
          await query(category("cat-herbs-new", "Herbs", 2, 3));
          await query(category("cat-empty", "Empty", 1, 4));
          await query(product("prod-coffee", "cat-coffee", null));
          await query(product("prod-tea-active", "cat-tea-dead", null));
          await query(product("prod-tea-retired", "cat-tea-dead", 9));
          await query(product("prod-herbs-old", "cat-herbs-old", null));
          await query(product("prod-herbs-new", "cat-herbs-new", null));
          await query(product("prod-empty-retired", "cat-empty", 9));
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("re-parents or keeps soft-deleted categories that still have active products", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const client = yield* PgClient.PgClient;
        const categories = yield* client.unsafe(
          `SELECT "id", "name", "row_version"::text AS "rowVersion" FROM "categories" WHERE "organization_id" = '${ORGANIZATION_ID}' ORDER BY "id"`,
        );
        const products = yield* client.unsafe(
          `SELECT "id", "category_id" AS "categoryId", "row_version"::text AS "rowVersion" FROM "products" WHERE "organization_id" = '${ORGANIZATION_ID}' ORDER BY "id"`,
        );
        const duplicate = yield* client
          .unsafe(category("cat-tea-again", "Tea", 1))
          .pipe(Effect.flip);
        return {
          categories: Schema.decodeUnknownSync(CategoryRows)(categories),
          products: Schema.decodeUnknownSync(ProductRows)(products),
          duplicate,
        };
      }),
    );
    expect(outcome.categories).toEqual([
      { id: "cat-coffee", name: "Coffee", rowVersion: "3" },
      { id: "cat-herbs-new", name: "Herbs", rowVersion: "4" },
      { id: "cat-tea-live", name: "Tea", rowVersion: "3" },
    ]);
    expect(outcome.products).toEqual([
      { id: "prod-coffee", categoryId: "cat-coffee", rowVersion: "5" },
      { id: "prod-empty-retired", categoryId: "cat-empty", rowVersion: "5" },
      { id: "prod-herbs-new", categoryId: "cat-herbs-new", rowVersion: "5" },
      { id: "prod-herbs-old", categoryId: "cat-herbs-new", rowVersion: "6" },
      { id: "prod-tea-active", categoryId: "cat-tea-live", rowVersion: "6" },
      { id: "prod-tea-retired", categoryId: "cat-tea-dead", rowVersion: "5" },
    ]);
    expect(outcome.duplicate).toBeDefined();
  });
});
