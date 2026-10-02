import type { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { CommitFanout } from "../inventory/model";

interface OrgHubStub {
  readonly publish: (input: CommitFanout) => Effect.Effect<number, unknown, RuntimeContext>;
}

interface OrgHubNamespace {
  readonly getByName: (organizationId: string) => OrgHubStub;
}

type RunInBackground = (
  effect: Effect.Effect<void, never, RuntimeContext>,
) => Effect.Effect<void, never, RuntimeContext>;

export interface LiveFanoutContract {
  readonly publish: (
    organizationId: string,
    fanout: CommitFanout,
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
    publish: (organizationId, fanout) =>
      runInBackground(
        Effect.suspend(() => hubs.getByName(organizationId).publish(fanout)).pipe(
          Effect.asVoid,
          logFailure("live.publish_failed"),
        ),
      ),
  });
