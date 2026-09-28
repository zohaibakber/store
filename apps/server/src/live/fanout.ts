import type { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { CommitFanout } from "../inventory/model";
import type { HubPublish } from "./hub-core";

export interface OrgHubStub {
  readonly publish: (input: HubPublish) => Effect.Effect<number, unknown, RuntimeContext>;
  readonly revoke: (userId: string) => Effect.Effect<number, unknown, RuntimeContext>;
}

export interface OrgHubNamespace {
  readonly getByName: (organizationId: string) => OrgHubStub;
}

export type RunInBackground = (
  effect: Effect.Effect<void, never, RuntimeContext>,
) => Effect.Effect<void, never, RuntimeContext>;

export interface LiveFanoutContract {
  readonly publish: (
    organizationId: string,
    fanout: CommitFanout,
    originReplicaId: string,
  ) => Effect.Effect<void, never, RuntimeContext>;
  readonly revoke: (
    organizationId: string,
    userId: string,
  ) => Effect.Effect<void, never, RuntimeContext>;
}

export class LiveFanout extends Context.Service<LiveFanout, LiveFanoutContract>()(
  "@store/server/LiveFanout",
) {}

const logFailure = (event: string) =>
  Effect.catchCause((cause: Cause.Cause<unknown>) =>
    Effect.logWarning(event).pipe(Effect.annotateLogs({ cause: Cause.pretty(cause) })),
  );

export const makeLiveFanout = (
  hubs: OrgHubNamespace,
  runInBackground: RunInBackground,
): LiveFanoutContract =>
  LiveFanout.of({
    publish: (organizationId, fanout, originReplicaId) =>
      runInBackground(
        Effect.suspend(() =>
          hubs.getByName(organizationId).publish({
            epoch: fanout.epoch,
            horizon: fanout.horizon,
            group: fanout.group,
            byteLength: fanout.byteLength,
            originReplicaId,
          }),
        ).pipe(Effect.asVoid, logFailure("live.publish_failed")),
      ),
    revoke: (organizationId, userId) =>
      runInBackground(
        Effect.suspend(() => hubs.getByName(organizationId).revoke(userId)).pipe(
          Effect.asVoid,
          logFailure("live.revoke_failed"),
        ),
      ),
  });
