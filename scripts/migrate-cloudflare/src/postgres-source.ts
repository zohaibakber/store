import * as PgClient from "@effect/sql-pg/PgClient";
import { OrganizationId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { casesHandled } from "./cases.ts";
import { persistingAs, SourceError } from "./errors.ts";
import {
  BusinessTable,
  type DriverRow,
  type DriverScalar,
  DriverScalar as DriverScalarSchema,
} from "./model.ts";
import { SourceCatalog } from "./source.ts";

const SafeIntegerFromBigInt = Schema.BigInt.check(
  Schema.isBetweenBigInt({
    minimum: BigInt(Number.MIN_SAFE_INTEGER),
    maximum: BigInt(Number.MAX_SAFE_INTEGER),
  }),
).pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transform({
      decode: (value) => Number(value),
      encode: (value) => BigInt(value),
    }),
  ),
);

const PgRow = Schema.Record(
  Schema.String,
  Schema.Union([DriverScalarSchema, SafeIntegerFromBigInt]),
);

const PageRequest = Schema.Struct({
  organizationId: OrganizationId,
  table: BusinessTable,
  afterId: Schema.String,
  limit: Schema.Int,
});
type PageRequest = typeof PageRequest.Encoded;

const Integerish = Schema.Union([Schema.Number, Schema.NumberFromString]);

const NUMERIC_KEYS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "deletedAt",
  "expiresAt",
  "rowVersion",
  "purchasePrice",
  "retailPrice",
  "unitPrice",
  "salePrice",
  "packQuantity",
  "unitQuantity",
  "baseUnitQuantity",
  "quantity",
  "packDelta",
  "unitDelta",
  "total",
  "invoiceNumber",
  "unitsPerPack",
]);

const coerceScalar = (key: string, value: DriverScalar): DriverScalar => {
  if (value === null || !NUMERIC_KEYS.has(key)) return value;
  const decoded = Schema.decodeUnknownOption(Integerish)(value);
  return Option.isSome(decoded) ? decoded.value : value;
};

const coerceRow = (row: DriverRow): DriverRow =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, coerceScalar(key, value)]));

const sourceFail = (operation: string, cause: unknown): SourceError =>
  new SourceError({
    operation,
    message: `PostgreSQL ${operation} failed.`,
    cause,
  });

const reading = (operation: string) => persistingAs((cause) => sourceFail(operation, cause));

const selectPage = (sql: PgClient.PgClient, page: PageRequest) => {
  switch (page.table) {
    case "categories":
      return sql`select id, name, tracks_packs as "tracksPacks", created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from categories where organization_id = ${page.organizationId} and id > ${page.afterId} order by id asc limit ${page.limit}`;
    case "products":
      return sql`select id, name, category_id as "categoryId", aisle, composition, strength, units_per_pack as "unitsPerPack", purchase_price as "purchasePrice", retail_price as "retailPrice", unit_price as "unitPrice", visible, created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from products where organization_id = ${page.organizationId} and id > ${page.afterId} order by id asc limit ${page.limit}`;
    case "batches":
      return sql`select id, product_id as "productId", batch_number as "batchNumber", expires_at as "expiresAt", pack_quantity as "packQuantity", unit_quantity as "unitQuantity", created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from batches where organization_id = ${page.organizationId} and id > ${page.afterId} order by id asc limit ${page.limit}`;
    case "invoices":
      return sql`select id, invoice_number as "invoiceNumber", customer_name as "customerName", total, created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from invoices where organization_id = ${page.organizationId} and id > ${page.afterId} order by id asc limit ${page.limit}`;
    case "invoice_items":
      return sql`select id, invoice_id as "invoiceId", product_id as "productId", batch_id as "batchId", product_name as "productName", batch_number as "batchNumber", quantity, quantity_type as "quantityType", base_unit_quantity as "baseUnitQuantity", sale_price as "salePrice", created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from invoice_items where organization_id = ${page.organizationId} and id > ${page.afterId} order by id asc limit ${page.limit}`;
    case "stock_movements":
      return sql`select id, product_id as "productId", batch_id as "batchId", invoice_id as "invoiceId", type, pack_delta as "packDelta", unit_delta as "unitDelta", note, organization_id as "organizationId", actor_user_id as "actorUserId", device_id as "deviceId", operation_id as "operationId", created_at as "createdAt" from stock_movements where organization_id = ${page.organizationId} and id > ${page.afterId} order by id asc limit ${page.limit}`;
    default:
      return casesHandled(page.table);
  }
};

const makePostgresSource = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const selectDatabase = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Schema.Struct({ name: Schema.String }),
    execute: () => sql`select current_database() as name`,
  });
  const selectRows = SqlSchema.findAll({
    Request: PageRequest,
    Result: PgRow,
    execute: (page) => selectPage(sql, page),
  });
  return SourceCatalog.of({
    identity: Effect.fn("Migrate.Postgres.identity")(function* () {
      const database = yield* selectDatabase(undefined);
      if (Option.isNone(database)) {
        return yield* sourceFail("identity", "current_database() returned no row.");
      }
      return database.value.name;
    }, reading("identity")),
    withSnapshot: (effect) =>
      sql`set transaction isolation level repeatable read, read only`.pipe(
        Effect.andThen(effect),
        sql.withTransaction,
        Effect.mapError((cause) => (isSqlError(cause) ? sourceFail("snapshot", cause) : cause)),
        Effect.withSpan("Migrate.Postgres.withSnapshot"),
      ),
    readPage: Effect.fn("Migrate.Postgres.readPage")(function* (
      organizationId: OrganizationId,
      table: BusinessTable,
      afterId: string,
      limit: number,
    ) {
      const transaction = yield* Effect.serviceOption(sql.transactionService);
      if (Option.isNone(transaction)) {
        return yield* new SourceError({
          operation: "readPage",
          message: "Source reads require a snapshot.",
        });
      }
      const rows = yield* selectRows({ organizationId, table, afterId, limit });
      return rows.map(coerceRow);
    }, reading("readPage")),
  });
});

export const postgresSourceLayer = (url: Redacted.Redacted): Layer.Layer<SourceCatalog, SqlError> =>
  Layer.effect(SourceCatalog, makePostgresSource).pipe(Layer.provide(PgClient.layer({ url })));
