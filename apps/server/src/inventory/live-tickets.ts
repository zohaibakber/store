import { OrgCommitSequence, SyncEpoch } from "@store/contracts";
import { inventoryState } from "@store/db/postgres/schema";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import {
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
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
  organizationId: string,
) {
  const [row] = yield* runStatement(
    db
      .select({
        status: inventoryState.status,
        releaseId: inventoryState.releaseId,
        epoch: inventoryState.epoch,
        commitSequence: inventoryState.commitSequence,
      })
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, organizationId))
      .limit(1),
  );
  const state = yield* requireReady(row);
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

const makeSharedHorizonReader = (
  read: (organizationId: string) => Effect.Effect<LiveHorizon, InventoryError>,
) => {
  const latest = new Map<string, SharedHorizon>();
  return Effect.fn("InventoryLive.sharedHorizon")(function* (organizationId: string) {
    const now = yield* Clock.currentTimeMillis;
    const shared = latest.get(organizationId);
    if (shared !== undefined && now - shared.readAt < LIVE_HORIZON_SHARING.maxAgeMillis) {
      return shared.horizon;
    }
    const horizon = yield* read(organizationId);
    latest.delete(organizationId);
    latest.set(organizationId, { horizon, readAt: now });
    if (latest.size > LIVE_HORIZON_SHARING.capacity) {
      const oldest = latest.keys().next();
      if (oldest.done !== true) latest.delete(oldest.value);
    }
    return horizon;
  });
};

export interface InventoryLiveContract {
  readonly readLiveHorizon: (actor: InventoryActor) => Effect.Effect<LiveHorizon, InventoryError>;
}

export class InventoryLive extends Context.Service<InventoryLive, InventoryLiveContract>()(
  "@store/server/InventoryLive",
) {}

export const makeInventoryLive = (db: InventoryDrizzle): InventoryLiveContract => {
  const sharedHorizon = makeSharedHorizonReader((organizationId) =>
    readLiveHorizonStatement(db, organizationId),
  );
  return InventoryLive.of({
    readLiveHorizon: Effect.fn("InventoryLive.readLiveHorizon")(function* (actor) {
      return yield* sharedHorizon(actor.organizationId);
    }),
  });
};

export const InventoryLiveUnavailable = Layer.succeed(
  InventoryLive,
  InventoryLive.of({
    readLiveHorizon: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
