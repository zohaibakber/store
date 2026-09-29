import {
  AcquireSnapshotResult,
  MAX_SNAPSHOT_PART_BYTES,
  MAX_SNAPSHOT_PART_ROWS,
  SNAPSHOT_LEASE_LIFETIME_MILLIS,
  SYNC_SCHEMA_VERSION,
  SyncProtocolCode,
  type AcquireSnapshotRequest,
  type SnapshotId,
} from "@store/contracts";
import { inventoryState, snapshotJobs, snapshotParts } from "@store/db/postgres/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { EncodedSnapshotPart, InventoryActor } from "./model";
import {
  databaseError,
  protocol,
  requireState,
  runStatement,
  type InventoryDrizzle,
} from "./postgres";

export type SnapshotPolicy = {
  readonly partRows: number;
  readonly partBytes: number;
  readonly leaseMillis: number;
  readonly lagTransactions: number;
  readonly minimumRebuildMillis: number;
};

export const SNAPSHOT_POLICY: SnapshotPolicy = {
  partRows: MAX_SNAPSHOT_PART_ROWS,
  partBytes: MAX_SNAPSHOT_PART_BYTES,
  leaseMillis: SNAPSHOT_LEASE_LIFETIME_MILLIS,
  lagTransactions: 2_000,
  minimumRebuildMillis: 15 * 60_000,
};

const AcquireSnapshotRefusal = Schema.TaggedStruct("error", {
  code: SyncProtocolCode,
  message: Schema.String,
});

const AcquireRow = Schema.Struct({
  result: Schema.fromJsonString(Schema.Union([AcquireSnapshotResult, AcquireSnapshotRefusal])),
});

const decodeAcquireRows = Schema.decodeUnknownEffect(Schema.Array(AcquireRow));

const acquireStatement = (
  actor: InventoryActor,
  request: AcquireSnapshotRequest,
  policy: SnapshotPolicy,
  now: number,
) => sql`
  select "sync"."acquire_snapshot"(
    ${actor.organizationId}::text,
    ${request.replicaId ?? null}::text,
    ${actor.userId}::text,
    ${request.epoch}::text,
    ${request.subscription}::text,
    ${SYNC_SCHEMA_VERSION}::integer,
    ${policy.partRows}::integer,
    ${policy.leaseMillis}::bigint,
    ${policy.lagTransactions}::bigint,
    ${policy.minimumRebuildMillis}::bigint,
    ${now}::bigint,
    ${policy.partBytes}::integer
  )::text as "result"
`;

const acquireSnapshotWith = Effect.fn("InventorySnapshots.acquireSnapshotWith")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  request: AcquireSnapshotRequest,
  policy: SnapshotPolicy,
) {
  const now = yield* Clock.currentTimeMillis;
  const raw = yield* runStatement(
    db.execute(acquireStatement(actor, request, policy, now), "objects"),
  );
  const [row] = yield* decodeAcquireRows(raw).pipe(Effect.mapError(databaseError));
  if (row === undefined) {
    return yield* Effect.fail(databaseError(new Error("Snapshot acquisition returned no row.")));
  }
  if (row.result._tag === "error") return yield* protocol(row.result.code, row.result.message);
  return row.result;
});

const readEncodedSnapshotPart = Effect.fn("InventorySnapshots.readEncodedSnapshotPart")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  snapshotId: SnapshotId,
  partNumber: number,
) {
  const [row] = yield* runStatement(
    db
      .select({
        publishedId: snapshotJobs.snapshotId,
        payloadJson: snapshotParts.payloadJson,
        sha256: snapshotParts.sha256,
      })
      .from(inventoryState)
      .leftJoin(
        snapshotJobs,
        and(
          eq(snapshotJobs.organizationId, inventoryState.organizationId),
          eq(snapshotJobs.snapshotId, snapshotId),
        ),
      )
      .leftJoin(
        snapshotParts,
        and(
          eq(snapshotParts.organizationId, snapshotJobs.organizationId),
          eq(snapshotParts.snapshotId, snapshotJobs.snapshotId),
          eq(snapshotParts.partNumber, partNumber),
        ),
      )
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1),
  );
  const found = yield* requireState(row);
  if (found.publishedId === null) {
    return yield* protocol("SNAPSHOT_UNAVAILABLE", "No snapshot is published for this id.");
  }
  if (found.payloadJson === null || found.sha256 === null) {
    return yield* protocol("SNAPSHOT_UNAVAILABLE", "The snapshot part does not exist.");
  }
  return { json: found.payloadJson, sha256: found.sha256 } satisfies EncodedSnapshotPart;
});

export interface InventorySnapshotsContract {
  readonly acquireSnapshot: (
    actor: InventoryActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, InventoryError>;
  readonly readSnapshotPartEncoded: (
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<EncodedSnapshotPart, InventoryError>;
}

export class InventorySnapshots extends Context.Service<
  InventorySnapshots,
  InventorySnapshotsContract
>()("@store/server/InventorySnapshots") {}

export const makeInventorySnapshots = (
  db: InventoryDrizzle,
  policy: SnapshotPolicy = SNAPSHOT_POLICY,
): InventorySnapshotsContract => {
  return InventorySnapshots.of({
    acquireSnapshot: Effect.fn("InventorySnapshots.acquireSnapshot")(function* (actor, request) {
      return yield* acquireSnapshotWith(db, actor, request, policy);
    }),
    readSnapshotPartEncoded: Effect.fn("InventorySnapshots.readSnapshotPartEncoded")(
      function* (actor, snapshotId, partNumber) {
        return yield* readEncodedSnapshotPart(db, actor, snapshotId, partNumber);
      },
    ),
  });
};
