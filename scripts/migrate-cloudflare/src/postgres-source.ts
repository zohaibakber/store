import type { OrganizationId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Client } from "pg";

import { ConfigurationError, SourceError } from "./errors.ts";
import {
  type BusinessTable,
  type DriverRow,
  type DriverScalar,
  DriverRow as DriverRowSchema,
  SourceIdentity,
} from "./model.ts";
import { SourceCatalog } from "./source.ts";

const decodeIdentity = Schema.decodeUnknownEffect(SourceIdentity);
const decodeDriverRows = Schema.decodeUnknownEffect(Schema.Array(DriverRowSchema));
const DatabaseNameRows = Schema.Array(Schema.Struct({ name: Schema.String }));
const decodeDatabaseNameRows = Schema.decodeUnknownEffect(DatabaseNameRows);
const Integerish = Schema.Union([Schema.Number, Schema.NumberFromString]);

export const PostgresSourceConfig = Schema.Struct({
  connectionString: Schema.NonEmptyString,
});
export interface PostgresSourceConfig extends Schema.Schema.Type<typeof PostgresSourceConfig> {}

const sourceFail = (operation: string, cause: unknown): SourceError =>
  new SourceError({
    operation,
    message: `PostgreSQL ${operation} failed.`,
    cause,
  });

const TABLE_SQL = {
  categories: `select id, name, tracks_packs as "tracksPacks", created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from categories where organization_id = $1 and id > $2 order by id asc limit $3`,
  products: `select id, name, category_id as "categoryId", aisle, composition, strength, units_per_pack as "unitsPerPack", purchase_price as "purchasePrice", retail_price as "retailPrice", unit_price as "unitPrice", visible, created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from products where organization_id = $1 and id > $2 order by id asc limit $3`,
  batches: `select id, product_id as "productId", batch_number as "batchNumber", expires_at as "expiresAt", pack_quantity as "packQuantity", unit_quantity as "unitQuantity", created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from batches where organization_id = $1 and id > $2 order by id asc limit $3`,
  invoices: `select id, invoice_number as "invoiceNumber", customer_name as "customerName", total, created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from invoices where organization_id = $1 and id > $2 order by id asc limit $3`,
  invoice_items: `select id, invoice_id as "invoiceId", product_id as "productId", batch_id as "batchId", product_name as "productName", batch_number as "batchNumber", quantity, quantity_type as "quantityType", base_unit_quantity as "baseUnitQuantity", sale_price as "salePrice", created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", organization_id as "organizationId", created_by_user_id as "createdByUserId", updated_by_user_id as "updatedByUserId", device_id as "deviceId", operation_id as "operationId", row_version as "rowVersion" from invoice_items where organization_id = $1 and id > $2 order by id asc limit $3`,
  stock_movements: `select id, product_id as "productId", batch_id as "batchId", invoice_id as "invoiceId", type, pack_delta as "packDelta", unit_delta as "unitDelta", note, organization_id as "organizationId", actor_user_id as "actorUserId", device_id as "deviceId", operation_id as "operationId", created_at as "createdAt" from stock_movements where organization_id = $1 and id > $2 order by id asc limit $3`,
} as const satisfies { readonly [Table in BusinessTable]: string };

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

const coerceRow = (row: DriverRow): DriverRow => {
  const next: Array<readonly [string, DriverScalar]> = [];
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value === undefined) continue;
    next.push([key, coerceScalar(key, value)]);
  }
  return Object.fromEntries(next);
};

export const postgresSourceLayer = (
  config: PostgresSourceConfig,
): Layer.Layer<SourceCatalog, ConfigurationError> =>
  Layer.effect(
    SourceCatalog,
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const next = new Client({ connectionString: config.connectionString });
            await next.connect();
            return next;
          },
          catch: () =>
            new ConfigurationError({
              message: "PostgreSQL connection failed.",
            }),
        }),
        (opened) =>
          Effect.promise(async () => {
            await opened.query("rollback").catch(() => undefined);
            await opened.end();
          }),
      );
      let frozen = false;
      return SourceCatalog.of({
        identity: Effect.fn("Migrate.Postgres.identity")(function* () {
          const result = yield* Effect.tryPromise({
            try: () => client.query("select current_database() as name"),
            catch: (cause) => sourceFail("identity", cause),
          });
          const named = yield* decodeDatabaseNameRows(result.rows).pipe(
            Effect.mapError((cause) => sourceFail("identity", cause)),
          );
          const name = named[0]?.name;
          return yield* decodeIdentity(name).pipe(
            Effect.mapError(() =>
              sourceFail("identity", new Error("current_database() returned an empty name.")),
            ),
          );
        }),
        freezeWrites: Effect.fn("Migrate.Postgres.freezeWrites")(function* () {
          if (frozen) return;
          yield* Effect.tryPromise({
            try: () => client.query("begin isolation level repeatable read read only"),
            catch: (cause) => sourceFail("freezeWrites", cause),
          });
          frozen = true;
        }),
        readPage: Effect.fn("Migrate.Postgres.readPage")(function* (
          organizationId: OrganizationId,
          table: BusinessTable,
          afterId: string,
          limit: number,
        ) {
          if (!frozen) {
            return yield* Effect.fail(
              new SourceError({
                operation: "readPage",
                message: "Source writes are not frozen.",
              }),
            );
          }
          const result = yield* Effect.tryPromise({
            try: () => client.query(TABLE_SQL[table], [organizationId, afterId, limit]),
            catch: (cause) => sourceFail("readPage", cause),
          });
          const decoded = yield* decodeDriverRows(result.rows).pipe(
            Effect.mapError((cause) => sourceFail("readPage", cause)),
          );
          return decoded.map(coerceRow);
        }),
      });
    }),
  );
