import {
  finishPartitionDigestReport,
  makePartitionEntityHasher,
  makePartitionLeafOrderer,
  PARTITION_ENTITIES,
  partitionEntityRecord,
  partitionLeafOf,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionEntity,
  type PartitionEntityDigest,
  type SyncSubscription,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { pendingRowMarks } from "@store/db/replica.schema";
import { and, asc, count, eq, gt, inArray, max, min, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ReplicaStorageError } from "./errors";
import type { ReplicaDb } from "./sql-client/drizzle";

const PAGE_ROWS = 4_000;

const leafTable = (entity: PartitionEntity) => {
  const { table } = syncEntityRows[entity];
  return {
    table,
    rowVersion:
      "rowVersion" in table
        ? sql`cast(${table.rowVersion} as integer)`
        : sql.raw(String(STOCK_MOVEMENT_ROW_VERSION)),
  };
};

const partitionEntityDigests = <E, R>(
  digestOf: (entity: PartitionEntity) => Effect.Effect<PartitionEntityDigest, E, R>,
): Effect.Effect<Readonly<Record<PartitionEntity, PartitionEntityDigest>>, E, R> =>
  Effect.all(partitionEntityRecord(digestOf));

const foreignOrganization = () =>
  new ReplicaStorageError({ message: "Replica partition holds more than one organization." });

const pendingQuery = (tx: ReplicaDb) =>
  tx
    .select({ pendingCount: count() })
    .from(pendingRowMarks)
    .where(inArray(pendingRowMarks.entity, [...PARTITION_ENTITIES]))
    .get();

const boundsQuery = (tx: ReplicaDb, entity: PartitionEntity) => {
  const { table } = leafTable(entity);
  return tx
    .select({
      entityCount: count(),
      organizationId: min(table.organizationId),
      highestOrganizationId: max(table.organizationId),
    })
    .from(table)
    .get();
};

const pageQuery = (
  tx: ReplicaDb,
  entity: PartitionEntity,
  organizationId: string,
  after: string | undefined,
) => {
  const { table, rowVersion } = leafTable(entity);
  return tx
    .select({ entityId: table.id, version: sql<string>`(${rowVersion}) || ''` })
    .from(table)
    .where(
      and(
        eq(table.organizationId, organizationId),
        after === undefined ? undefined : gt(table.id, after),
      ),
    )
    .orderBy(asc(table.id))
    .limit(PAGE_ROWS)
    .all();
};

export type DigestReader<Failure> = <A>(
  read: (tx: ReplicaDb) => Effect.Effect<A, EffectDrizzleQueryError>,
) => Effect.Effect<A, Failure>;

const entityDigest = Effect.fn("ReplicaDigest.sqliteEntityDigest")(function* <Failure>(
  read: DigestReader<Failure>,
  entity: PartitionEntity,
) {
  const bounds = yield* read((tx) => boundsQuery(tx, entity));
  const entityCount = bounds?.entityCount ?? 0;
  const hasher = makePartitionEntityHasher(entity, entityCount);
  if (!bounds || bounds.organizationId === null) {
    return { count: entityCount, digest: hasher.finish() };
  }
  if (bounds.highestOrganizationId !== bounds.organizationId) return yield* foreignOrganization();
  const organizationId = bounds.organizationId;
  const orderer = makePartitionLeafOrderer(hasher.push);
  yield* Stream.paginate(Option.none<string>(), (after) =>
    read((tx) => pageQuery(tx, entity, organizationId, Option.getOrUndefined(after))).pipe(
      Effect.map((rows) => {
        const last = rows.at(-1);
        return [
          rows,
          rows.length < PAGE_ROWS || last === undefined
            ? Option.none()
            : Option.some(Option.some(last.entityId)),
        ] as const;
      }),
    ),
  ).pipe(
    Stream.runForEach((row) =>
      Effect.sync(() =>
        orderer.push(row.entityId, partitionLeafOf(entity, row.entityId, row.version)),
      ),
    ),
  );
  orderer.finish();
  return { count: entityCount, digest: hasher.finish() };
});

export const readPartitionDigest = Effect.fn("ReplicaDigest.readPartitionDigest")(function* <
  Failure,
>(read: DigestReader<Failure>) {
  const pending = yield* read(pendingQuery);
  if ((pending?.pendingCount ?? 0) > 0) return undefined;
  return yield* finishPartitionDigestReport(
    yield* partitionEntityDigests((entity) => entityDigest(read, entity)),
  );
});

export const sqlitePartitionDigest = Effect.fn("ReplicaDigest.sqlitePartitionDigest")(function* (
  tx: ReplicaDb,
) {
  return yield* readPartitionDigest<EffectDrizzleQueryError>((read) => read(tx));
});

export const logPartitionDivergence = (
  subscription: SyncSubscription,
  diverged: ReadonlyArray<PartitionEntity>,
) =>
  Effect.logWarning("replica.digest_diverged").pipe(
    Effect.annotateLogs({ subscription, entities: diverged }),
  );
