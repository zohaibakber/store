import {
  PARTITION_ENTITIES,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionEntity,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { sha256Hex } from "@store/contracts/operation-hash";
import { downloadLeases, replicas, snapshotParts, snapshots } from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { refuse, type AuthorityActor, type AuthorityEngine, type AuthorityState } from "./engine";
import { byteLengthOf } from "./frames";

export type SnapshotPolicy = {
  readonly partRows: number;
  readonly partBytes: number;
  readonly leaseMillis: number;
  readonly lagTransactions: number;
  readonly minimumRebuildMillis: number;
};

const SCAN_ROWS = 1_000;

const SNAPSHOT_SUBSCRIPTION = "operational";

const SOFT_DELETED_ENTITIES: ReadonlySet<PartitionEntity> = new Set(["product", "batch"]);

const SINCE_VERSION = {
  category: 3,
  product: 3,
  batch: 3,
  invoice: 3,
  invoiceItem: 3,
  stockMovement: 3,
  supplier: 4,
  purchaseOrder: 4,
  purchaseOrderItem: 4,
} as const satisfies Record<PartitionEntity, number>;

type Snapshot = typeof snapshots.$inferSelect;

const decodeEntityCounts = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Natural)),
);

export const isFresh = (
  head: number,
  snapshot: Snapshot | undefined,
  now: number,
  policy: Pick<SnapshotPolicy, "lagTransactions" | "minimumRebuildMillis">,
) =>
  snapshot !== undefined &&
  (head - snapshot.horizon <= policy.lagTransactions ||
    now - snapshot.publishedAt < policy.minimumRebuildMillis);

type ScannedRow = {
  readonly id: string;
  readonly version: number;
  readonly row: object;
};

const rowFrame = (entity: PartitionEntity, scanned: ScannedRow) => {
  const image = SOFT_DELETED_ENTITIES.has(entity)
    ? { ...scanned.row, deletedAt: null }
    : scanned.row;
  return `{"entity":${JSON.stringify(entity)},"entityId":${JSON.stringify(scanned.id)},"rowVersion":${scanned.version},"row":${JSON.stringify(image)}}`;
};

const scanPage = (db: ReplicaDb, entity: PartitionEntity, after: string | undefined) => {
  const { table } = syncEntityRows[entity];
  const version =
    "rowVersion" in table
      ? sql<number>`${table.rowVersion}`
      : sql<number>`${STOCK_MOVEMENT_ROW_VERSION}`;
  return db
    .select({ id: table.id, version, row: table })
    .from(table)
    .where(after === undefined ? undefined : gt(table.id, after))
    .orderBy(asc(table.id))
    .limit(SCAN_ROWS)
    .all();
};

export const makeAuthoritySnapshots = (
  engine: AuthorityEngine,
  db: ReplicaDb,
  mintId: Effect.Effect<string>,
) => {
  const newest = db
    .select()
    .from(snapshots)
    .orderBy(desc(snapshots.horizon), asc(snapshots.snapshotId))
    .limit(1)
    .get();

  const build = Effect.fn("AuthoritySnapshots.build")(function* (
    state: AuthorityState,
    now: number,
    policy: Pick<SnapshotPolicy, "partRows" | "partBytes">,
  ) {
    const snapshotId = yield* mintId;
    const partRows = Math.max(policy.partRows, 1);
    const partBytes = Math.max(policy.partBytes, 1);
    const counts: Record<string, number> = {};
    let partNumber = 1;
    let held: Array<string> = [];
    let position = 0;
    let bytesBefore = 0;
    let key: string | undefined;
    const flush = Effect.fnUntraced(function* () {
      const payload = `{"snapshotId":${JSON.stringify(snapshotId)},"partNumber":${partNumber},"rows":[${held.join(",")}]}`;
      yield* db.insert(snapshotParts).values({
        snapshotId,
        partNumber,
        byteLength: byteLengthOf(payload),
        sha256: yield* sha256Hex(payload),
        payloadJson: payload,
      });
      held = [];
    });
    for (const entity of PARTITION_ENTITIES) {
      counts[entity] = 0;
      let after: string | undefined;
      while (true) {
        const page: ReadonlyArray<ScannedRow> = yield* scanPage(db, entity, after);
        for (const row of page) {
          const frame = rowFrame(entity, row);
          const next = `${Math.floor(bytesBefore / partBytes)}:${Math.floor(position / partRows)}`;
          if (key !== undefined && next !== key) {
            yield* flush();
            partNumber += 1;
          }
          key = next;
          held.push(frame);
          position += 1;
          bytesBefore += byteLengthOf(frame) + 1;
          counts[entity] += 1;
        }
        const last = page.at(-1);
        if (last === undefined || page.length < SCAN_ROWS) break;
        after = last.id;
      }
    }
    yield* flush();
    yield* db.insert(snapshots).values({
      snapshotId,
      subscription: SNAPSHOT_SUBSCRIPTION,
      horizon: state.commitSequence,
      publishedAt: now,
      entityCountsJson: JSON.stringify(counts),
    });
    return snapshotId;
  });

  const manifest = Effect.fn("AuthoritySnapshots.manifest")(function* (
    state: AuthorityState,
    snapshot: Snapshot,
    schemaVersion: number,
  ) {
    const parts = yield* db
      .select()
      .from(snapshotParts)
      .where(eq(snapshotParts.snapshotId, snapshot.snapshotId))
      .orderBy(asc(snapshotParts.partNumber))
      .all();
    const stored = yield* decodeEntityCounts(snapshot.entityCountsJson).pipe(Effect.orDie);
    const counted = PARTITION_ENTITIES.map((entity) => ({
      entity,
      rowCount: stored[entity] ?? 0,
    }));
    const digestVersion = Math.max(
      3,
      ...counted.filter((count) => count.rowCount > 0).map((count) => SINCE_VERSION[count.entity]),
    );
    return {
      snapshotId: snapshot.snapshotId,
      epoch: state.epoch,
      subscription: snapshot.subscription,
      schemaVersion,
      horizon: String(snapshot.horizon),
      parts: parts.map((part) => ({
        partNumber: part.partNumber,
        objectKey: `${state.organizationId}/${part.snapshotId}/${part.partNumber}`,
        byteLength: part.byteLength,
        sha256: part.sha256,
      })),
      entityCounts: counted.filter((count) => SINCE_VERSION[count.entity] <= digestVersion),
      digestVersion,
    };
  });

  return {
    newest,
    build,

    acquire: Effect.fn("AuthoritySnapshots.acquire")(function* (
      actor: AuthorityActor,
      request: {
        readonly epoch: string;
        readonly subscription: string;
        readonly replicaId: string | undefined;
      },
      schemaVersion: number,
      now: number,
      policy: SnapshotPolicy,
    ) {
      return yield* engine.transact(
        Effect.gen(function* () {
          const state = yield* engine.requireState(actor);
          if (state.epoch !== request.epoch) {
            return yield* refuse("EPOCH_MISMATCH", "The replica epoch does not match.");
          }
          if (request.subscription !== SNAPSHOT_SUBSCRIPTION) {
            return yield* refuse(
              "SCHEMA_VERSION_UNSUPPORTED",
              "Only the operational subscription is published.",
            );
          }
          if (request.replicaId !== undefined) {
            const replica = yield* db
              .select({ ownerUserId: replicas.ownerUserId })
              .from(replicas)
              .where(eq(replicas.replicaId, request.replicaId))
              .get();
            if (replica === undefined) {
              return yield* refuse("REPLICA_UNKNOWN", "This replica is not registered.");
            }
            if (replica.ownerUserId !== actor.userId) {
              return yield* refuse(
                "REPLICA_OWNED_BY_OTHER",
                "This replica belongs to another user.",
              );
            }
          }
          let chosen = yield* newest;
          if (chosen === undefined || !isFresh(state.commitSequence, chosen, now, policy)) {
            const built = yield* build(state, now, policy);
            chosen = yield* db
              .select()
              .from(snapshots)
              .where(eq(snapshots.snapshotId, built))
              .get();
          }
          if (chosen === undefined) {
            return yield* refuse("SNAPSHOT_UNAVAILABLE", "The snapshot could not be published.");
          }
          if (request.replicaId !== undefined) {
            const lease = {
              snapshotId: chosen.snapshotId,
              pinnedHorizon: chosen.horizon,
              expiresAt: now + policy.leaseMillis,
            };
            yield* db
              .insert(downloadLeases)
              .values({ replicaId: request.replicaId, ...lease })
              .onConflictDoUpdate({ target: downloadLeases.replicaId, set: lease });
          }
          return {
            _tag: "ready" as const,
            manifest: yield* manifest(state, chosen, schemaVersion),
          };
        }),
      );
    }),

    readPart: Effect.fn("AuthoritySnapshots.readPart")(function* (
      actor: AuthorityActor,
      snapshotId: string,
      partNumber: number,
    ) {
      return yield* engine.transact(
        Effect.gen(function* () {
          yield* engine.requireState(actor);
          const snapshot = yield* db
            .select({ snapshotId: snapshots.snapshotId })
            .from(snapshots)
            .where(eq(snapshots.snapshotId, snapshotId))
            .get();
          if (snapshot === undefined) {
            return yield* refuse("SNAPSHOT_UNAVAILABLE", "No snapshot is published for this id.");
          }
          const part = yield* db
            .select({ json: snapshotParts.payloadJson, sha256: snapshotParts.sha256 })
            .from(snapshotParts)
            .where(
              and(
                eq(snapshotParts.snapshotId, snapshotId),
                eq(snapshotParts.partNumber, partNumber),
              ),
            )
            .get();
          if (part === undefined) {
            return yield* refuse("SNAPSHOT_UNAVAILABLE", "The snapshot part does not exist.");
          }
          return part;
        }),
      );
    }),

    clearForImport: Effect.fn("AuthoritySnapshots.clearForImport")(function* () {
      yield* db.delete(downloadLeases);
      yield* db.delete(snapshotParts);
      yield* db.delete(snapshots);
    }),
  };
};

export type AuthoritySnapshots = ReturnType<typeof makeAuthoritySnapshots>;
