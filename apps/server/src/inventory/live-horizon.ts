import { OrgCommitSequence, SyncEpoch } from "@store/contracts";
import { inventoryState, replicas } from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import {
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  protocol,
  requireReady,
  runStatement,
  type InventoryDrizzle,
} from "./postgres";

export type LiveHorizon = {
  readonly epoch: SyncEpoch;
  readonly horizon: OrgCommitSequence;
};

const readLiveHorizonStatement = Effect.fn("InventoryLive.readHorizonStatement")(function* (
  db: InventoryDrizzle,
  actor: InventoryActor,
  replicaId: string,
) {
  const [row] = yield* runStatement(
    db
      .select({
        status: inventoryState.status,
        releaseId: inventoryState.releaseId,
        epoch: inventoryState.epoch,
        commitSequence: inventoryState.commitSequence,
        ownerUserId: replicas.ownerUserId,
      })
      .from(inventoryState)
      .leftJoin(
        replicas,
        and(
          eq(replicas.organizationId, inventoryState.organizationId),
          eq(replicas.replicaId, replicaId),
        ),
      )
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1),
  );
  const state = yield* requireReady(row);
  if (state.ownerUserId === null) {
    return yield* protocol("REPLICA_UNKNOWN", "This replica is not registered.");
  }
  if (state.ownerUserId !== actor.userId) {
    return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
  }
  return {
    epoch: SyncEpoch.make(state.epoch),
    horizon: OrgCommitSequence.make(integerTextFromNumeric(state.commitSequence)),
  } satisfies LiveHorizon;
});

export const LIVE_HORIZON_SHARING = {
  maxAgeMillis: 1_000,
  capacity: 1_024,
} as const;

type SharedHorizon = { readonly horizon: LiveHorizon; readonly readAt: number };

const sharingKey = (actor: InventoryActor, replicaId: string) =>
  JSON.stringify([actor.organizationId, actor.userId, replicaId]);

const makeSharedHorizonReader = (
  read: (actor: InventoryActor, replicaId: string) => Effect.Effect<LiveHorizon, InventoryError>,
) => {
  const latest = new Map<string, SharedHorizon>();
  return Effect.fn("InventoryLive.sharedHorizon")(function* (
    actor: InventoryActor,
    replicaId: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const key = sharingKey(actor, replicaId);
    const shared = latest.get(key);
    if (shared !== undefined && now - shared.readAt < LIVE_HORIZON_SHARING.maxAgeMillis) {
      return shared.horizon;
    }
    const horizon = yield* read(actor, replicaId);
    latest.delete(key);
    latest.set(key, { horizon, readAt: now });
    if (latest.size > LIVE_HORIZON_SHARING.capacity) {
      const oldest = latest.keys().next();
      if (oldest.done !== true) latest.delete(oldest.value);
    }
    return horizon;
  });
};

export interface InventoryLiveContract {
  readonly readLiveHorizon: (
    actor: InventoryActor,
    replicaId: string,
  ) => Effect.Effect<LiveHorizon, InventoryError>;
}

export class InventoryLive extends Context.Service<InventoryLive, InventoryLiveContract>()(
  "@store/server/InventoryLive",
) {}

export const makeInventoryLive = (db: InventoryDrizzle): InventoryLiveContract => {
  const sharedHorizon = makeSharedHorizonReader((actor, replicaId) =>
    readLiveHorizonStatement(db, actor, replicaId),
  );
  return InventoryLive.of({
    readLiveHorizon: Effect.fn("InventoryLive.readLiveHorizon")(function* (actor, replicaId) {
      return yield* sharedHorizon(actor, replicaId);
    }),
  });
};

export const InventoryLiveUnavailable = Layer.succeed(
  InventoryLive,
  InventoryLive.of({
    readLiveHorizon: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
