import * as Effect from "effect/Effect";

import { sha256Hex } from "./operation-hash";
import {
  CATALOG_PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION,
  type CatalogPartitionDigestReport,
  type HistoryPartitionDigestReport,
  type PartitionDigestReport,
  type PartitionDigestVersion,
  type SyncSubscription,
} from "./protocol";
import type { SyncEntity } from "./schema";

export const partitionDigestDomain = (version: PartitionDigestVersion): string =>
  `store.sync.partition-digest.v${version}`;

export const PARTITION_DIGEST_DOMAIN = partitionDigestDomain(PARTITION_DIGEST_VERSION);

export const PARTITION_LEAF_SEPARATOR = "\n";

export const STOCK_MOVEMENT_ROW_VERSION = 1;

export const CATALOG_PARTITION_ENTITIES = [
  "category",
  "product",
  "batch",
] as const satisfies ReadonlyArray<SyncEntity>;

export const HISTORY_PARTITION_ENTITIES = [
  "invoice",
  "invoiceItem",
  "stockMovement",
] as const satisfies ReadonlyArray<SyncEntity>;

export const PARTITION_ENTITIES = [
  ...CATALOG_PARTITION_ENTITIES,
  ...HISTORY_PARTITION_ENTITIES,
] as const satisfies ReadonlyArray<SyncEntity>;

export type CatalogPartitionEntity = (typeof CATALOG_PARTITION_ENTITIES)[number];

export type PartitionEntity = (typeof PARTITION_ENTITIES)[number];

const DIGEST_VERSION_ENTITIES = {
  [CATALOG_PARTITION_DIGEST_VERSION]: CATALOG_PARTITION_ENTITIES,
  [PARTITION_DIGEST_VERSION]: PARTITION_ENTITIES,
} as const satisfies Record<PartitionDigestVersion, ReadonlyArray<PartitionEntity>>;

export const digestVersionEntities = (
  version: PartitionDigestVersion,
): ReadonlyArray<PartitionEntity> => DIGEST_VERSION_ENTITIES[version];

const SUBSCRIPTION_ENTITIES = {
  operational: PARTITION_ENTITIES,
} as const satisfies Record<SyncSubscription, ReadonlyArray<PartitionEntity>>;

export const subscriptionEntities = (
  subscription: SyncSubscription,
): ReadonlyArray<PartitionEntity> => SUBSCRIPTION_ENTITIES[subscription];

export const isCatalogPartitionEntity = (entity: SyncEntity): entity is CatalogPartitionEntity =>
  CATALOG_PARTITION_ENTITIES.some((candidate) => candidate === entity);

export type PartitionLeafList = {
  readonly count: number;
  readonly leaves: string;
};

export type CatalogPartitionLeafLists = Readonly<Record<CatalogPartitionEntity, PartitionLeafList>>;

export type HistoryPartitionLeafLists = Readonly<Record<PartitionEntity, PartitionLeafList>>;

export type PartitionLeafLists =
  | {
      readonly version: typeof CATALOG_PARTITION_DIGEST_VERSION;
      readonly lists: CatalogPartitionLeafLists;
    }
  | {
      readonly version: typeof PARTITION_DIGEST_VERSION;
      readonly lists: HistoryPartitionLeafLists;
    };

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
    invoice: leavesOf("invoice"),
    invoiceItem: leavesOf("invoiceItem"),
    stockMovement: leavesOf("stockMovement"),
  } satisfies HistoryPartitionLeafLists;
};

const entityDigest = (domain: string, entity: PartitionEntity, list: PartitionLeafList) =>
  sha256Hex([domain, entity, String(list.count), list.leaves].join(PARTITION_LEAF_SEPARATOR));

const combinedDigest = (
  domain: string,
  entities: ReadonlyArray<PartitionEntity>,
  lists: Readonly<Partial<Record<PartitionEntity, PartitionLeafList>>>,
  digests: Readonly<Partial<Record<PartitionEntity, string>>>,
) => {
  const count = entities.reduce((total, entity) => total + (lists[entity]?.count ?? 0), 0);
  return sha256Hex(
    [domain, String(count), ...entities.map((entity) => `${entity}:${digests[entity] ?? ""}`)].join(
      PARTITION_LEAF_SEPARATOR,
    ),
  ).pipe(Effect.map((digest) => ({ digest, count })));
};

export const partitionDigestReport = Effect.fn("PartitionDigest.report")(function* (
  input: PartitionLeafLists,
) {
  const domain = partitionDigestDomain(input.version);
  const catalog = {
    category: yield* entityDigest(domain, "category", input.lists.category),
    product: yield* entityDigest(domain, "product", input.lists.product),
    batch: yield* entityDigest(domain, "batch", input.lists.batch),
  };
  if (input.version === CATALOG_PARTITION_DIGEST_VERSION) {
    const combined = yield* combinedDigest(
      domain,
      CATALOG_PARTITION_ENTITIES,
      input.lists,
      catalog,
    );
    return {
      version: CATALOG_PARTITION_DIGEST_VERSION,
      digest: combined.digest,
      count: combined.count,
      entities: catalog,
    } satisfies CatalogPartitionDigestReport;
  }
  const entities = {
    ...catalog,
    invoice: yield* entityDigest(domain, "invoice", input.lists.invoice),
    invoiceItem: yield* entityDigest(domain, "invoiceItem", input.lists.invoiceItem),
    stockMovement: yield* entityDigest(domain, "stockMovement", input.lists.stockMovement),
  };
  const combined = yield* combinedDigest(domain, PARTITION_ENTITIES, input.lists, entities);
  return {
    version: PARTITION_DIGEST_VERSION,
    digest: combined.digest,
    count: combined.count,
    entities,
  } satisfies HistoryPartitionDigestReport;
});

export const partitionDigestOf = (
  sources: Iterable<PartitionLeafSource>,
  version: PartitionDigestVersion = PARTITION_DIGEST_VERSION,
) => {
  const lists = partitionLeafLists(sources);
  return partitionDigestReport(
    version === CATALOG_PARTITION_DIGEST_VERSION
      ? {
          version,
          lists: { category: lists.category, product: lists.product, batch: lists.batch },
        }
      : { version, lists },
  );
};

const entityDigestOf = (
  report: PartitionDigestReport,
  entity: PartitionEntity,
): string | undefined => {
  if (report.version === PARTITION_DIGEST_VERSION) return report.entities[entity];
  return isCatalogPartitionEntity(entity) ? report.entities[entity] : undefined;
};

export const divergedPartitionEntities = (
  local: PartitionDigestReport,
  authority: PartitionDigestReport,
): ReadonlyArray<PartitionEntity> =>
  digestVersionEntities(authority.version).filter(
    (entity) => entityDigestOf(local, entity) !== entityDigestOf(authority, entity),
  );
