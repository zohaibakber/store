import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  LIVE_LEASE_LIFETIME_MILLIS,
  MAX_SNAPSHOT_PART_ROWS,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotManifest,
  SnapshotPartHash,
  SnapshotPartPayload,
  SnapshotRow,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncProtocolError,
  type SyncEntity,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  batches,
  categories,
  downloadLeases,
  inventoryState,
  products,
  snapshotJobs,
  snapshotParts,
} from "@store/db/postgres/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InventoryDatabaseError } from "./errors";
import type { InventoryActor } from "./model";
import {
  databaseError,
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  protocol,
  requireReady,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

const snapshotDatabaseError = (cause: unknown) =>
  databaseError(cause, "Inventory snapshot failed.");

const PARTITION_ENTITIES = [
  "category",
  "product",
  "batch",
] as const satisfies ReadonlyArray<SyncEntity>;

const secureRandomHex = (byteCount: number): string =>
  Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(byteCount)));

const collectEntityRows = (
  tx: InventoryTransaction,
  organizationId: string,
  entity: (typeof PARTITION_ENTITIES)[number],
): Effect.Effect<ReadonlyArray<SnapshotRow>, InventoryDatabaseError> =>
  Effect.gen(function* () {
    switch (entity) {
      case "category": {
        const rows = yield* tx
          .select()
          .from(categories)
          .where(and(eq(categories.organizationId, organizationId), isNull(categories.deletedAt)))
          .orderBy(asc(categories.id));
        return rows.map((row) => ({
          entity,
          entityId: row.id,
          rowVersion: Number(row.rowVersion),
          row,
        }));
      }
      case "product": {
        const rows = yield* tx
          .select()
          .from(products)
          .where(and(eq(products.organizationId, organizationId), isNull(products.deletedAt)))
          .orderBy(asc(products.id));
        return rows.map((row) => ({
          entity,
          entityId: row.id,
          rowVersion: Number(row.rowVersion),
          row,
        }));
      }
      case "batch": {
        const rows = yield* tx
          .select()
          .from(batches)
          .where(and(eq(batches.organizationId, organizationId), isNull(batches.deletedAt)))
          .orderBy(asc(batches.id));
        return rows.map((row) => ({
          entity,
          entityId: row.id,
          rowVersion: Number(row.rowVersion),
          row,
        }));
      }
      default: {
        const _exhaustive: never = entity;
        return _exhaustive;
      }
    }
  }).pipe(Effect.mapError(snapshotDatabaseError));

const chunkRows = <A>(rows: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  if (rows.length === 0) return [[]];
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

const buildManifest = (
  snapshotId: SnapshotId,
  epoch: string,
  horizon: string,
  parts: ReadonlyArray<typeof snapshotParts.$inferSelect>,
  entityCounts: SnapshotManifest["entityCounts"],
): SnapshotManifest => ({
  snapshotId,
  epoch: SyncEpoch.make(epoch),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: SYNC_SCHEMA_VERSION,
  horizon: OrgCommitSequence.make(integerTextFromNumeric(horizon)),
  parts: parts.map((part) => ({
    partNumber: part.partNumber,
    objectKey: part.objectKey,
    byteLength: part.byteLength,
    sha256: Schema.decodeUnknownSync(SnapshotPartHash)(part.sha256),
  })),
  entityCounts,
});

const publishCurrentSnapshot = (
  tx: InventoryTransaction,
  actor: InventoryActor,
  now: number,
): Effect.Effect<SnapshotManifest, SyncProtocolError | InventoryDatabaseError> =>
  Effect.gen(function* () {
    const [state] = yield* tx
      .select()
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .for("update")
      .limit(1)
      .pipe(Effect.mapError(snapshotDatabaseError));
    yield* requireReady(state);
    if (!state)
      return yield* protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");

    const [existing] = yield* tx
      .select()
      .from(snapshotJobs)
      .where(
        and(
          eq(snapshotJobs.organizationId, actor.organizationId),
          eq(snapshotJobs.stage, "published"),
          eq(snapshotJobs.subscription, OPERATIONAL_SUBSCRIPTION),
        ),
      )
      .orderBy(asc(snapshotJobs.snapshotId))
      .limit(1)
      .pipe(Effect.mapError(snapshotDatabaseError));
    if (existing && existing.horizon !== null) {
      const parts = yield* tx
        .select()
        .from(snapshotParts)
        .where(
          and(
            eq(snapshotParts.organizationId, actor.organizationId),
            eq(snapshotParts.snapshotId, existing.snapshotId),
          ),
        )
        .orderBy(asc(snapshotParts.partNumber))
        .pipe(Effect.mapError(snapshotDatabaseError));
      const entityCounts: Array<SnapshotManifest["entityCounts"][number]> = [];
      for (const entity of PARTITION_ENTITIES) {
        const rows = yield* collectEntityRows(tx, actor.organizationId, entity);
        entityCounts.push({ entity, rowCount: rows.length });
      }
      return buildManifest(
        SnapshotId.make(existing.snapshotId),
        state.epoch,
        existing.horizon,
        parts,
        entityCounts,
      );
    }

    const snapshotId = SnapshotId.make(secureRandomHex(16));
    const horizon = integerTextFromNumeric(state.commitSequence);
    yield* tx
      .insert(snapshotJobs)
      .values({
        organizationId: actor.organizationId,
        snapshotId,
        subscription: OPERATIONAL_SUBSCRIPTION,
        stage: "exporting",
        fence: 1,
        ownerToken: secureRandomHex(8),
        startedAtCommitSequence: horizon,
        horizon,
        copyEntity: null,
        copyCursor: null,
        stepDueAt: now,
      })
      .pipe(Effect.mapError(snapshotDatabaseError));

    const allRows: SnapshotRow[] = [];
    const entityCounts: Array<SnapshotManifest["entityCounts"][number]> = [];
    for (const entity of PARTITION_ENTITIES) {
      const rows = yield* collectEntityRows(tx, actor.organizationId, entity);
      entityCounts.push({ entity, rowCount: rows.length });
      allRows.push(...rows);
    }

    let partNumber = 1;
    const chunks = chunkRows(allRows, MAX_SNAPSHOT_PART_ROWS);
    for (const chunk of chunks) {
      const part: SnapshotPartPayload = {
        snapshotId,
        partNumber,
        rows: chunk,
      };
      const payloadJson = Schema.encodeSync(Schema.fromJsonString(SnapshotPartPayload))(part);
      const sha256 = canonicalPayloadHash(part);
      const objectKey = `${actor.organizationId}/${snapshotId}/${partNumber}`;
      yield* tx
        .insert(snapshotParts)
        .values({
          organizationId: actor.organizationId,
          snapshotId,
          partNumber,
          objectKey,
          byteLength: new TextEncoder().encode(payloadJson).length,
          sha256,
          payloadJson,
        })
        .pipe(Effect.mapError(snapshotDatabaseError));
      partNumber += 1;
    }

    yield* tx
      .update(snapshotJobs)
      .set({ stage: "published", fence: 2, stepDueAt: now })
      .where(
        and(
          eq(snapshotJobs.organizationId, actor.organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
        ),
      )
      .pipe(Effect.mapError(snapshotDatabaseError));

    const parts = yield* tx
      .select()
      .from(snapshotParts)
      .where(
        and(
          eq(snapshotParts.organizationId, actor.organizationId),
          eq(snapshotParts.snapshotId, snapshotId),
        ),
      )
      .orderBy(asc(snapshotParts.partNumber))
      .pipe(Effect.mapError(snapshotDatabaseError));

    return buildManifest(snapshotId, state.epoch, horizon, parts, entityCounts);
  });

const grantLease = (
  tx: InventoryTransaction,
  organizationId: string,
  replicaId: string,
  snapshotId: string,
  horizon: string,
  expiresAt: number,
) =>
  tx
    .insert(downloadLeases)
    .values({
      organizationId,
      replicaId,
      snapshotId,
      pinnedHorizon: horizon,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [downloadLeases.organizationId, downloadLeases.replicaId],
      set: {
        snapshotId,
        pinnedHorizon: horizon,
        expiresAt,
      },
    })
    .pipe(Effect.mapError(snapshotDatabaseError));

export const acquireSnapshotInTransaction = (
  tx: InventoryTransaction,
  actor: InventoryActor,
  request: AcquireSnapshotRequest,
  replicaId: string | undefined,
  now: number,
): Effect.Effect<AcquireSnapshotResult, SyncProtocolError | InventoryDatabaseError> =>
  Effect.gen(function* () {
    const [state] = yield* tx
      .select()
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1)
      .pipe(Effect.mapError(snapshotDatabaseError));
    yield* requireReady(state);
    if (!state)
      return yield* protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");
    if (state.epoch !== request.epoch) {
      return yield* protocol("EPOCH_MISMATCH", "The replica epoch does not match.");
    }
    if (request.subscription !== OPERATIONAL_SUBSCRIPTION) {
      return yield* protocol(
        "SCHEMA_VERSION_UNSUPPORTED",
        "Only the operational subscription is published.",
      );
    }

    const manifest = yield* publishCurrentSnapshot(tx, actor, now);
    if (replicaId) {
      yield* grantLease(
        tx,
        actor.organizationId,
        replicaId,
        manifest.snapshotId,
        manifest.horizon,
        now + LIVE_LEASE_LIFETIME_MILLIS,
      );
    }
    return { _tag: "ready" as const, manifest };
  });

export const readSnapshotPartInTransaction = (
  tx: InventoryTransaction,
  actor: InventoryActor,
  snapshotId: SnapshotId,
  partNumber: number,
): Effect.Effect<SnapshotPartPayload, SyncProtocolError | InventoryDatabaseError> =>
  Effect.gen(function* () {
    const [state] = yield* tx
      .select({ status: inventoryState.status, releaseId: inventoryState.releaseId })
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1)
      .pipe(Effect.mapError(snapshotDatabaseError));
    yield* requireReady(state);

    const [job] = yield* tx
      .select()
      .from(snapshotJobs)
      .where(
        and(
          eq(snapshotJobs.organizationId, actor.organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
          eq(snapshotJobs.stage, "published"),
        ),
      )
      .limit(1)
      .pipe(Effect.mapError(snapshotDatabaseError));
    if (!job) {
      return yield* protocol("SNAPSHOT_UNAVAILABLE", "No snapshot is published for this id.");
    }

    const [part] = yield* tx
      .select()
      .from(snapshotParts)
      .where(
        and(
          eq(snapshotParts.organizationId, actor.organizationId),
          eq(snapshotParts.snapshotId, snapshotId),
          eq(snapshotParts.partNumber, partNumber),
        ),
      )
      .limit(1)
      .pipe(Effect.mapError(snapshotDatabaseError));
    if (!part) {
      return yield* protocol("SNAPSHOT_UNAVAILABLE", "The snapshot part does not exist.");
    }

    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SnapshotPartPayload))(
      part.payloadJson,
    ).pipe(Effect.mapError(snapshotDatabaseError));
  });

export type InventorySnapshotsError = SyncProtocolError | InventoryDatabaseError;

export interface InventorySnapshotsContract {
  readonly acquireSnapshot: (
    actor: InventoryActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, InventorySnapshotsError>;
  readonly readSnapshotPart: (
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<SnapshotPartPayload, InventorySnapshotsError>;
}

export class InventorySnapshots extends Context.Service<
  InventorySnapshots,
  InventorySnapshotsContract
>()("@store/server/InventorySnapshots") {}

export const makeInventorySnapshots = (db: InventoryDrizzle): InventorySnapshotsContract => {
  const transact = runTransaction(db);
  return InventorySnapshots.of({
    acquireSnapshot: Effect.fn("InventorySnapshots.acquireSnapshot")(function* (actor, request) {
      const now = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        acquireSnapshotInTransaction(tx, actor, request, undefined, now),
      );
    }),
    readSnapshotPart: Effect.fn("InventorySnapshots.readSnapshotPart")(
      function* (actor, snapshotId, partNumber) {
        return yield* transact("repeatable read", "read only", (tx) =>
          readSnapshotPartInTransaction(tx, actor, snapshotId, partNumber),
        );
      },
    ),
  });
};

export const InventorySnapshotsUnavailable = Layer.succeed(
  InventorySnapshots,
  InventorySnapshots.of({
    acquireSnapshot: () => Effect.fail(inventoryPostgresUnavailable),
    readSnapshotPart: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
