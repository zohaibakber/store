import {
  CATALOG_PARTITION_DIGEST_VERSION,
  digestVersionEntities,
  partitionDigestReport,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionDigestVersion,
  type PartitionEntity,
  type PartitionLeafList,
  type SyncSubscription,
} from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  pendingRowMarks,
  products,
  stockMovements,
} from "@store/db/replica.schema";
import { inArray, sql, type SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ReplicaStorageError } from "./errors";
import type { ReplicaDb } from "./sql-client/drizzle";

const CatalogLeafListsRow = Schema.Struct({
  pendingCount: Schema.Number,
  categoryCount: Schema.Number,
  categoryLeaves: Schema.NullOr(Schema.String),
  productCount: Schema.Number,
  productLeaves: Schema.NullOr(Schema.String),
  batchCount: Schema.Number,
  batchLeaves: Schema.NullOr(Schema.String),
});

const HistoryLeafListsRow = Schema.Struct({
  ...CatalogLeafListsRow.fields,
  invoiceCount: Schema.Number,
  invoiceLeaves: Schema.NullOr(Schema.String),
  invoiceItemCount: Schema.Number,
  invoiceItemLeaves: Schema.NullOr(Schema.String),
  stockMovementCount: Schema.Number,
  stockMovementLeaves: Schema.NullOr(Schema.String),
});

const decodeCatalogRow = Schema.decodeUnknownEffect(CatalogLeafListsRow);
const decodeHistoryRow = Schema.decodeUnknownEffect(HistoryLeafListsRow);

type LeafTable =
  | typeof categories
  | typeof products
  | typeof batches
  | typeof invoices
  | typeof invoiceItems
  | typeof stockMovements;

const leafTables = {
  category: { table: categories, rowVersion: sql`cast(${categories.rowVersion} as integer)` },
  product: { table: products, rowVersion: sql`cast(${products.rowVersion} as integer)` },
  batch: { table: batches, rowVersion: sql`cast(${batches.rowVersion} as integer)` },
  invoice: { table: invoices, rowVersion: sql`cast(${invoices.rowVersion} as integer)` },
  invoiceItem: {
    table: invoiceItems,
    rowVersion: sql`cast(${invoiceItems.rowVersion} as integer)`,
  },
  stockMovement: { table: stockMovements, rowVersion: sql.raw(String(STOCK_MOVEMENT_ROW_VERSION)) },
} as const satisfies Record<
  PartitionEntity,
  { readonly table: LeafTable; readonly rowVersion: SQL }
>;

const leafSelections = (entity: PartitionEntity) => {
  const { table, rowVersion } = leafTables[entity];
  return sql`(select count(*) from ${table}) as ${sql.identifier(`${entity}Count`)},
    (select group_concat("leaf", char(10) order by "leaf") from (select ${`${entity}:`} || ${table.id} || ':' || ${rowVersion} as "leaf" from ${table})) as ${sql.identifier(`${entity}Leaves`)}`;
};

const leafListsStatement = (version: PartitionDigestVersion) => {
  const entities = digestVersionEntities(version);
  return sql`select
    (select count(*) from ${pendingRowMarks} where ${inArray(pendingRowMarks.entity, [...entities])}) as "pendingCount",
    ${sql.join(entities.map(leafSelections), sql`, `)}`;
};

const listOf = (count: number, leaves: string | null): PartitionLeafList => ({
  count,
  leaves: leaves ?? "",
});

const malformed = () =>
  ReplicaStorageError.make({ message: "Replica partition digest rows are malformed." });

export const sqlitePartitionDigest = Effect.fn("ReplicaDigest.sqlitePartitionDigest")(function* (
  tx: ReplicaDb,
  version: PartitionDigestVersion,
) {
  const raw = yield* tx.get<unknown>(leafListsStatement(version));
  if (version === CATALOG_PARTITION_DIGEST_VERSION) {
    const row = yield* decodeCatalogRow(raw).pipe(Effect.mapError(malformed));
    if (row.pendingCount > 0) return undefined;
    return yield* partitionDigestReport({
      version,
      lists: {
        category: listOf(row.categoryCount, row.categoryLeaves),
        product: listOf(row.productCount, row.productLeaves),
        batch: listOf(row.batchCount, row.batchLeaves),
      },
    });
  }
  const row = yield* decodeHistoryRow(raw).pipe(Effect.mapError(malformed));
  if (row.pendingCount > 0) return undefined;
  return yield* partitionDigestReport({
    version,
    lists: {
      category: listOf(row.categoryCount, row.categoryLeaves),
      product: listOf(row.productCount, row.productLeaves),
      batch: listOf(row.batchCount, row.batchLeaves),
      invoice: listOf(row.invoiceCount, row.invoiceLeaves),
      invoiceItem: listOf(row.invoiceItemCount, row.invoiceItemLeaves),
      stockMovement: listOf(row.stockMovementCount, row.stockMovementLeaves),
    },
  });
});

export const logPartitionDivergence = (
  subscription: SyncSubscription,
  diverged: ReadonlyArray<PartitionEntity>,
) => Effect.logWarning("replica partition digest diverged", { subscription, entities: diverged });
