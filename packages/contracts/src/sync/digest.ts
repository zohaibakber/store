import { compareCodeUnits } from "./canonical-json";
import { canonicalPayloadHash } from "./operation-hash";
import type { PartitionDigest, SyncSubscription } from "./protocol";
import type { SyncEntity } from "./schema";
import type { SnapshotRow } from "./snapshot";

export const PARTITION_DIGEST_DOMAIN = "store.sync.partition-digest.v1";

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
