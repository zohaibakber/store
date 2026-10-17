import {
  compareUtf8,
  PARTITION_DIGEST_DOMAIN,
  PARTITION_DIGEST_VERSION,
  PARTITION_ENTITIES,
  partitionLeafOf,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionEntity,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { sha256Hex } from "@store/contracts/operation-hash";
import type { ReplicaDb } from "@store/sync/authority";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

const SEPARATOR = "\n";

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
  readonly version: typeof PARTITION_DIGEST_VERSION;
  readonly digest: string;
  readonly count: number;
  readonly entities: Readonly<Record<string, string>>;
};

export const partitionDigest = Effect.fn("Authority.partitionDigest")(function* (
  db: ReplicaDb,
) {
  const domain = PARTITION_DIGEST_DOMAIN;
  const digests: Array<{ readonly entity: PartitionEntity; readonly digest: string }> = [];
  let count = 0;
  for (const entity of PARTITION_ENTITIES) {
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
    version: PARTITION_DIGEST_VERSION,
    digest: yield* sha256Hex(
      [domain, String(count), ...digests.map(({ entity, digest }) => `${entity}:${digest}`)].join(
        SEPARATOR,
      ),
    ),
    count,
    entities: Object.fromEntries(digests.map(({ entity, digest }) => [entity, digest])),
  } satisfies DigestReport;
});
