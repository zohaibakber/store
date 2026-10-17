import {
  compareUtf8,
  PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION_V3,
  PARTITION_ENTITIES,
  PARTITION_ENTITIES_V3,
  partitionLeafOf,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionEntity,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { sha256Hex } from "@store/contracts/operation-hash";
import type { ReplicaDb } from "@store/sync/authority";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

export type DigestVersion = typeof PARTITION_DIGEST_VERSION | typeof PARTITION_DIGEST_VERSION_V3;

export const isDigestVersion = (version: number): version is DigestVersion =>
  version === PARTITION_DIGEST_VERSION || version === PARTITION_DIGEST_VERSION_V3;

const SEPARATOR = "\n";

const entitiesOf = (version: DigestVersion): ReadonlyArray<PartitionEntity> =>
  version === PARTITION_DIGEST_VERSION ? PARTITION_ENTITIES : PARTITION_ENTITIES_V3;

const leavesOf = Effect.fnUntraced(function* (db: ReplicaDb, entity: PartitionEntity) {
  const { table } = syncEntityRows[entity];
  const version =
    "rowVersion" in table
      ? sql<number>`${table.rowVersion}`
      : sql<number>`${STOCK_MOVEMENT_ROW_VERSION}`;
  const rows = yield* db.select({ id: table.id, version }).from(table).all();
  return rows.map((row) => partitionLeafOf(entity, row.id, String(row.version))).sort(compareUtf8);
});

export type DigestReport = {
  readonly version: DigestVersion;
  readonly digest: string;
  readonly count: number;
  readonly entities: Readonly<Record<string, string>>;
};

export const partitionDigest = Effect.fn("Authority.partitionDigest")(function* (
  db: ReplicaDb,
  version: DigestVersion,
) {
  const domain = `store.sync.partition-digest.v${version}`;
  const entities = entitiesOf(version);
  const digests: Array<{ readonly entity: PartitionEntity; readonly digest: string }> = [];
  let count = 0;
  for (const entity of entities) {
    const leaves = yield* leavesOf(db, entity);
    count += leaves.length;
    digests.push({
      entity,
      digest: yield* sha256Hex(
        [domain, entity, String(leaves.length), leaves.join(SEPARATOR)].join(SEPARATOR),
      ),
    });
  }
  return {
    version,
    digest: yield* sha256Hex(
      [domain, String(count), ...digests.map(({ entity, digest }) => `${entity}:${digest}`)].join(
        SEPARATOR,
      ),
    ),
    count,
    entities: Object.fromEntries(digests.map(({ entity, digest }) => [entity, digest])),
  } satisfies DigestReport;
});
