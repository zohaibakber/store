import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CommitFanout } from "../authority/frames";
import { OrgHubs } from "./org-hubs";

const logFailure = (event: string) =>
  Effect.catchCause((cause: Cause.Cause<unknown>) =>
    Effect.logWarning(event).pipe(Effect.annotateLogs({ cause: Cause.pretty(cause) })),
  );

export class LiveFanout extends Context.Service<
  LiveFanout,
  {
    readonly publish: (
      organizationId: string,
      fanout: CommitFanout,
    ) => Effect.Effect<void, never, RuntimeContext>;
  }
>()("@store/server/LiveFanout") {
  static readonly layer = Layer.effect(
    LiveFanout,
    Effect.gen(function* () {
      const hubs = yield* OrgHubs;
      const execution = yield* Cloudflare.WorkerExecutionContext;

      const publish = Effect.fn("LiveFanout.publish")(function* (
        organizationId: string,
        fanout: CommitFanout,
      ) {
        yield* execution.waitUntil(
          Effect.suspend(() => hubs.getByName(organizationId).publish(fanout)).pipe(
            Effect.asVoid,
            logFailure("live.publish_failed"),
          ),
        );
      });

      return LiveFanout.of({ publish });
    }),
  );
}
