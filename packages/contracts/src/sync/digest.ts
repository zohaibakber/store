import * as Effect from "effect/Effect";

import { sha256Hex } from "./operation-hash";
import {
  PARTITION_DIGEST_VERSION,
  type PartitionDigestReport,
  type SyncSubscription,
} from "./protocol";
import type { SyncEntity } from "./schema";

export const PARTITION_DIGEST_DOMAIN = "store.sync.partition-digest.v2";

export const PARTITION_LEAF_SEPARATOR = "\n";

export const PARTITION_ENTITIES = [
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

export type PartitionLeafList = {
  readonly count: number;
  readonly leaves: string;
};

export type PartitionLeafLists = Readonly<Record<PartitionEntity, PartitionLeafList>>;

export type PartitionLeafSource = {
  readonly entity: PartitionEntity;
  readonly entityId: string;
  readonly rowVersion: number;
};

export const partitionLeaf = (source: PartitionLeafSource): string =>
  `${source.entity}:${source.entityId}:${source.rowVersion}`;

const codePointRank = (unit: number): number => {
  if (unit >= 0xd800 && unit <= 0xdfff) return unit + 0x2000;
  if (unit >= 0xe000) return unit - 0x800;
  return unit;
};

export const compareUtf8 = (left: string, right: string): number => {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const difference =
      codePointRank(left.charCodeAt(index)) - codePointRank(right.charCodeAt(index));
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

export const sortedPartitionLeaves = (leaves: ReadonlyArray<string>): PartitionLeafList => ({
  count: leaves.length,
  leaves: [...leaves].sort(compareUtf8).join(PARTITION_LEAF_SEPARATOR),
});

export const partitionLeafLists = (sources: Iterable<PartitionLeafSource>) => {
  const all = [...sources];
  const leavesOf = (entity: PartitionEntity) =>
    sortedPartitionLeaves(all.filter((source) => source.entity === entity).map(partitionLeaf));
  return {
    category: leavesOf("category"),
    product: leavesOf("product"),
    batch: leavesOf("batch"),
  } satisfies PartitionLeafLists;
};

const entityDigest = (entity: PartitionEntity, list: PartitionLeafList) =>
  sha256Hex(
    [PARTITION_DIGEST_DOMAIN, entity, String(list.count), list.leaves].join(
      PARTITION_LEAF_SEPARATOR,
    ),
  );

export const partitionDigestReport = Effect.fn("PartitionDigest.report")(function* (
  lists: PartitionLeafLists,
) {
  const entities = {
    category: yield* entityDigest("category", lists.category),
    product: yield* entityDigest("product", lists.product),
    batch: yield* entityDigest("batch", lists.batch),
  };
  const count = PARTITION_ENTITIES.reduce((total, entity) => total + lists[entity].count, 0);
  const digest = yield* sha256Hex(
    [
      PARTITION_DIGEST_DOMAIN,
      String(count),
      ...PARTITION_ENTITIES.map((entity) => `${entity}:${entities[entity]}`),
    ].join(PARTITION_LEAF_SEPARATOR),
  );
  return {
    version: PARTITION_DIGEST_VERSION,
    digest,
    count,
    entities,
  } satisfies PartitionDigestReport;
});

export const partitionDigestOf = (sources: Iterable<PartitionLeafSource>) =>
  partitionDigestReport(partitionLeafLists(sources));

export const divergedPartitionEntities = (
  local: PartitionDigestReport,
  authority: PartitionDigestReport,
): ReadonlyArray<PartitionEntity> =>
  PARTITION_ENTITIES.filter((entity) => local.entities[entity] !== authority.entities[entity]);
