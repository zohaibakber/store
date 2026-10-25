import type { OrganizationId, UserId } from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { causeDiagnostics } from "./errors";

interface RevocableHubs {
  readonly getByName: (organizationId: string) => {
    readonly revoke: (userId: string) => Effect.Effect<unknown, unknown, RuntimeContext>;
  };
}

type RunInBackground = (
  effect: Effect.Effect<void, never, RuntimeContext>,
) => Effect.Effect<void, never, RuntimeContext>;

export class HubRevocation extends Context.Service<
  HubRevocation,
  {
    readonly revoke: (
      organizationId: OrganizationId,
      userId: UserId,
    ) => Effect.Effect<void, never, RuntimeContext>;
  }
>()("@store/auth-worker/HubRevocation") {
  static readonly layer = (hubs: RevocableHubs, runInBackground: RunInBackground) =>
    Layer.succeed(
      this,
      this.of({
        revoke: (organizationId, userId) =>
          runInBackground(
            Effect.suspend(() => hubs.getByName(organizationId).revoke(userId)).pipe(
              Effect.asVoid,
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                  ? Effect.interrupt
                  : Effect.logWarning("auth.hub_revoke_failed").pipe(
                      Effect.annotateLogs({ organizationId, userId, ...causeDiagnostics(cause) }),
                    ),
              ),
            ),
          ),
      }),
    );
}
