import { sha256 } from "@noble/hashes/sha2.js";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";

import { sha256Hex } from "./operation-hash";
import { PARTITION_DIGEST_VERSION, type PartitionDigestReport } from "./protocol";
import type { SyncEntity } from "./schema";

export const PARTITION_DIGEST_DOMAIN = `store.sync.partition-digest.v${PARTITION_DIGEST_VERSION}`;

const PARTITION_LEAF_SEPARATOR = "\n";

const utf8 = new TextEncoder();

export const STOCK_MOVEMENT_ROW_VERSION = 1;

export const PARTITION_ENTITIES = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
] as const satisfies ReadonlyArray<SyncEntity>;

export type PartitionEntity = (typeof PARTITION_ENTITIES)[number];

type PartitionLeafList = {
  readonly count: number;
  readonly leaves: string;
};

type PartitionLeafLists = Readonly<Record<PartitionEntity, PartitionLeafList>>;

export type PartitionLeafSource = {
  readonly entity: PartitionEntity;
  readonly entityId: string;
  readonly rowVersion: number;
};

const partitionLeaf = (source: PartitionLeafSource): string =>
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

const entityDigest = (entity: PartitionEntity, list: PartitionLeafList) =>
  sha256Hex(
    [PARTITION_DIGEST_DOMAIN, entity, String(list.count), list.leaves].join(
      PARTITION_LEAF_SEPARATOR,
    ),
  );

export type PartitionEntityDigest = {
  readonly count: number;
  readonly digest: string;
};

type PartitionEntityHasher = {
  readonly push: (leaf: string) => void;
  readonly finish: () => string;
};

const HASHER_FLUSH_CHARS = 1 << 15;

export const makePartitionEntityHasher = (
  entity: PartitionEntity,
  count: number,
): PartitionEntityHasher => {
  const hash = sha256.create();
  let pending = [PARTITION_DIGEST_DOMAIN, entity, String(count), ""].join(PARTITION_LEAF_SEPARATOR);
  let first = true;
  const flush = () => {
    if (pending.length === 0) return;
    hash.update(utf8.encode(pending));
    pending = "";
  };
  return {
    push: (leaf) => {
      pending += first ? leaf : `${PARTITION_LEAF_SEPARATOR}${leaf}`;
      first = false;
      if (pending.length >= HASHER_FLUSH_CHARS) flush();
    },
    finish: () => {
      flush();
      return Encoding.encodeHex(hash.digest());
    },
  };
};

type PartitionLeafOrderer = {
  readonly push: (entityId: string, leaf: string) => void;
  readonly finish: () => void;
};

type OrdererEntry = { readonly entityId: string; readonly leaf: string };

export const makePartitionLeafOrderer = (emit: (leaf: string) => void): PartitionLeafOrderer => {
  const held: Array<OrdererEntry> = [];
  const insert = (entry: OrdererEntry) => {
    let low = 0;
    let high = held.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const pivot = held[middle];
      if (pivot !== undefined && compareUtf8(pivot.leaf, entry.leaf) > 0) low = middle + 1;
      else high = middle;
    }
    held.splice(low, 0, entry);
  };
  return {
    push: (entityId, leaf) => {
      insert({ entityId, leaf });
      for (let next = held.at(-1); next !== undefined; next = held.at(-1)) {
        if (entityId.startsWith(next.entityId)) return;
        held.pop();
        emit(next.leaf);
      }
    },
    finish: () => {
      for (let next = held.pop(); next !== undefined; next = held.pop()) emit(next.leaf);
    },
  };
};

export const partitionLeafOf = (entity: PartitionEntity, entityId: string, version: string) =>
  `${entity}:${entityId}:${version}`;

export const finishPartitionDigestReport = Effect.fn("PartitionDigest.finish")(function* (
  entities: Readonly<Record<PartitionEntity, PartitionEntityDigest>>,
) {
  const count = PARTITION_ENTITIES.reduce((total, entity) => total + entities[entity].count, 0);
  const digest = yield* sha256Hex(
    [
      PARTITION_DIGEST_DOMAIN,
      String(count),
      ...PARTITION_ENTITIES.map((entity) => `${entity}:${entities[entity].digest}`),
    ].join(PARTITION_LEAF_SEPARATOR),
  );
  return {
    version: PARTITION_DIGEST_VERSION,
    digest,
    count,
    entities: {
      category: entities.category.digest,
      product: entities.product.digest,
      batch: entities.batch.digest,
      invoice: entities.invoice.digest,
      invoiceItem: entities.invoiceItem.digest,
      stockMovement: entities.stockMovement.digest,
    },
  } satisfies PartitionDigestReport;
});

const partitionDigestReport = Effect.fn("PartitionDigest.report")(function* (
  lists: PartitionLeafLists,
) {
  return yield* finishPartitionDigestReport({
    category: {
      count: lists.category.count,
      digest: yield* entityDigest("category", lists.category),
    },
    product: { count: lists.product.count, digest: yield* entityDigest("product", lists.product) },
    batch: { count: lists.batch.count, digest: yield* entityDigest("batch", lists.batch) },
    invoice: { count: lists.invoice.count, digest: yield* entityDigest("invoice", lists.invoice) },
    invoiceItem: {
      count: lists.invoiceItem.count,
      digest: yield* entityDigest("invoiceItem", lists.invoiceItem),
    },
    stockMovement: {
      count: lists.stockMovement.count,
      digest: yield* entityDigest("stockMovement", lists.stockMovement),
    },
  });
});

export const partitionDigestOf = (sources: Iterable<PartitionLeafSource>) => {
  const all = [...sources];
  const leavesOf = (entity: PartitionEntity) =>
    sortedPartitionLeaves(all.filter((source) => source.entity === entity).map(partitionLeaf));
  return partitionDigestReport({
    category: leavesOf("category"),
    product: leavesOf("product"),
    batch: leavesOf("batch"),
    invoice: leavesOf("invoice"),
    invoiceItem: leavesOf("invoiceItem"),
    stockMovement: leavesOf("stockMovement"),
  });
};

export const divergedPartitionEntities = (
  local: PartitionDigestReport,
  authority: PartitionDigestReport,
): ReadonlyArray<PartitionEntity> =>
  PARTITION_ENTITIES.filter((entity) => local.entities[entity] !== authority.entities[entity]);
