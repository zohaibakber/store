import {
  partitionDigestReport,
  subscriptionEntities,
  type PartitionEntity,
  type SyncSubscription,
} from "@store/contracts";
import { batches, categories, pendingRowMarks, products } from "@store/db/replica.schema";
import { inArray, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ReplicaStorageError } from "./errors";
import type { ReplicaDb } from "./sql-client/drizzle";

const LeafListsRow = Schema.Struct({
  pendingCount: Schema.Number,
  categoryCount: Schema.Number,
  categoryLeaves: Schema.NullOr(Schema.String),
  productCount: Schema.Number,
  productLeaves: Schema.NullOr(Schema.String),
  batchCount: Schema.Number,
  batchLeaves: Schema.NullOr(Schema.String),
});

const decodeLeafListsRow = Schema.decodeUnknownEffect(LeafListsRow);

type LeafTable = typeof categories | typeof products | typeof batches;

const orderedLeaves = (entity: PartitionEntity, table: LeafTable) =>
  sql`(select group_concat("leaf", char(10) order by "leaf") from (select ${`${entity}:`} || ${table.id} || ':' || cast(${table.rowVersion} as integer) as "leaf" from ${table}))`;

const leafCount = (table: LeafTable) => sql`(select count(*) from ${table})`;

const leafListsStatement = (subscription: SyncSubscription) =>
  sql`select
    (select count(*) from ${pendingRowMarks} where ${inArray(pendingRowMarks.entity, [...subscriptionEntities(subscription)])}) as "pendingCount",
    ${leafCount(categories)} as "categoryCount",
    ${orderedLeaves("category", categories)} as "categoryLeaves",
    ${leafCount(products)} as "productCount",
    ${orderedLeaves("product", products)} as "productLeaves",
    ${leafCount(batches)} as "batchCount",
    ${orderedLeaves("batch", batches)} as "batchLeaves"`;

export const sqlitePartitionDigest = Effect.fn("ReplicaDigest.sqlitePartitionDigest")(function* (
  tx: ReplicaDb,
  subscription: SyncSubscription,
) {
  const raw = yield* tx.get<unknown>(leafListsStatement(subscription));
  const row = yield* decodeLeafListsRow(raw).pipe(
    Effect.mapError(() =>
      ReplicaStorageError.make({ message: "Replica partition digest rows are malformed." }),
    ),
  );
  if (row.pendingCount > 0) return undefined;
  return yield* partitionDigestReport({
    category: { count: row.categoryCount, leaves: row.categoryLeaves ?? "" },
    product: { count: row.productCount, leaves: row.productLeaves ?? "" },
    batch: { count: row.batchCount, leaves: row.batchLeaves ?? "" },
  });
});

export const logPartitionDivergence = (
  subscription: SyncSubscription,
  diverged: ReadonlyArray<PartitionEntity>,
) => Effect.logWarning("replica partition digest diverged", { subscription, entities: diverged });
