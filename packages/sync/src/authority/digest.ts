import {
  compareCodeUnits,
  type PartitionDigest,
  type SnapshotRow,
  type SyncEntity,
  type SyncSubscription,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { batches, categories, products } from "@store/db/inventory.schema";
import { and, asc, eq, gt } from "drizzle-orm";

import type { SqliteConnection } from "../sqlite";

const PARTITION_DIGEST_DOMAIN = "store.sync.partition-digest.v1";

const PARTITION_ENTITIES = [
  "category",
  "product",
  "batch",
] as const satisfies ReadonlyArray<SyncEntity>;

export type PartitionEntity = (typeof PARTITION_ENTITIES)[number];

const SUBSCRIPTION_ENTITIES = {
  operational: PARTITION_ENTITIES,
} as const satisfies Record<SyncSubscription, ReadonlyArray<PartitionEntity>>;

export const subscriptionEntities = (
  subscription: SyncSubscription,
): ReadonlyArray<PartitionEntity> => SUBSCRIPTION_ENTITIES[subscription];

export const nextPartitionEntity = (
  subscription: SyncSubscription,
  entity: PartitionEntity,
): PartitionEntity | undefined => {
  const entities = subscriptionEntities(subscription);
  return entities[entities.indexOf(entity) + 1];
};

export type PartitionPage = {
  readonly organizationId: string;
  readonly entity: PartitionEntity;
  readonly afterEntityId: string | undefined;
  readonly limit: number;
};

export const readPartitionPage = (
  tx: SqliteConnection,
  page: PartitionPage,
): ReadonlyArray<SnapshotRow> => {
  const entity = page.entity;
  const after = page.afterEntityId;
  switch (entity) {
    case "category":
      return tx
        .select()
        .from(categories)
        .where(
          after === undefined
            ? eq(categories.organizationId, page.organizationId)
            : and(eq(categories.organizationId, page.organizationId), gt(categories.id, after)),
        )
        .orderBy(asc(categories.id))
        .limit(page.limit)
        .all()
        .map((row) => ({ entity, entityId: row.id, rowVersion: row.rowVersion, row }));
    case "product":
      return tx
        .select()
        .from(products)
        .where(
          after === undefined
            ? eq(products.organizationId, page.organizationId)
            : and(eq(products.organizationId, page.organizationId), gt(products.id, after)),
        )
        .orderBy(asc(products.id))
        .limit(page.limit)
        .all()
        .map((row) => ({ entity, entityId: row.id, rowVersion: row.rowVersion, row }));
    case "batch":
      return tx
        .select()
        .from(batches)
        .where(
          after === undefined
            ? eq(batches.organizationId, page.organizationId)
            : and(eq(batches.organizationId, page.organizationId), gt(batches.id, after)),
        )
        .orderBy(asc(batches.id))
        .limit(page.limit)
        .all()
        .map((row) => ({ entity, entityId: row.id, rowVersion: row.rowVersion, row }));
  }
};

const PARTITION_READ_PAGE_ROWS = 1000;

export const readPartitionEntity = (
  tx: SqliteConnection,
  organizationId: string,
  entity: PartitionEntity,
): ReadonlyArray<SnapshotRow> => {
  const collected: SnapshotRow[] = [];
  let afterEntityId: string | undefined = undefined;
  for (;;) {
    const page = readPartitionPage(tx, {
      organizationId,
      entity,
      afterEntityId,
      limit: PARTITION_READ_PAGE_ROWS,
    });
    collected.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < PARTITION_READ_PAGE_ROWS) return collected;
    afterEntityId = last.entityId;
  }
};

export const rowImageDigest = (rows: ReadonlyArray<SnapshotRow>): PartitionDigest => {
  const leaves = rows.map((row) =>
    canonicalPayloadHash([row.entity, row.entityId, row.rowVersion, row.row]),
  );
  return canonicalPayloadHash([
    PARTITION_DIGEST_DOMAIN,
    rows.length,
    [...leaves].sort(compareCodeUnits),
  ]);
};

export const partitionDigest = (
  tx: SqliteConnection,
  input: {
    readonly organizationId: string;
    readonly subscription: SyncSubscription;
  },
): PartitionDigest =>
  rowImageDigest(
    subscriptionEntities(input.subscription).flatMap((entity) =>
      readPartitionEntity(tx, input.organizationId, entity),
    ),
  );
