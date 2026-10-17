import { OrgCommitSequence, SyncEpoch } from "@store/contracts";
import * as Effect from "effect/Effect";

import { answered, type AuthorityNamespace } from "./authority-client";
import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";

export type LiveHorizon = {
  readonly epoch: SyncEpoch;
  readonly horizon: OrgCommitSequence;
};

export const makeInventoryLive = <R, E>(authorities: AuthorityNamespace<R, E>) => ({
  readLiveHorizon: Effect.fn("InventoryLive.readLiveHorizon")(function* (
    actor: InventoryActor,
    replicaId: string,
  ): Effect.fn.Return<LiveHorizon, InventoryError, R> {
    const horizon = yield* answered(
      authorities.getByName(actor.organizationId).liveHorizon(actor, replicaId),
    );
    return {
      epoch: SyncEpoch.make(horizon.epoch),
      horizon: OrgCommitSequence.make(horizon.horizon),
    } satisfies LiveHorizon;
  }),
});
