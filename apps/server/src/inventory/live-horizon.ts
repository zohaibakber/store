import { OrgCommitSequence, SyncEpoch } from "@store/contracts";
import { inventoryState, replicas } from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import {
  integerTextFromNumeric,
  protocol,
  requireState,
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
  const seenAt = yield* Clock.currentTimeMillis;
  const seen = db.$with("seen").as(
    db
      .update(replicas)
      .set({ lastSeenAt: seenAt })
      .where(
        and(
          eq(replicas.organizationId, actor.organizationId),
          eq(replicas.replicaId, replicaId),
          eq(replicas.ownerUserId, actor.userId),
        ),
      )
      .returning({ replicaId: replicas.replicaId }),
  );
  const [row] = yield* runStatement(
    db
      .with(seen)
      .select({
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
  const state = yield* requireState(row);
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

interface InventoryLiveContract {
  readonly readLiveHorizon: (
    actor: InventoryActor,
    replicaId: string,
  ) => Effect.Effect<LiveHorizon, InventoryError>;
}

export const makeInventoryLive = (db: InventoryDrizzle) =>
  ({
    readLiveHorizon: Effect.fn("InventoryLive.readLiveHorizon")(function* (actor, replicaId) {
      return yield* readLiveHorizonStatement(db, actor, replicaId);
    }),
  }) satisfies InventoryLiveContract;
