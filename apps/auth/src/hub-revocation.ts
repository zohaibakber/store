import type { OrganizationId, UserId } from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { causeDiagnostics } from "./errors";

interface HubRevocationContract {
  readonly revoke: (
    organizationId: OrganizationId,
    userId: UserId,
  ) => Effect.Effect<void, never, RuntimeContext>;
}

export class HubRevocation extends Context.Service<HubRevocation, HubRevocationContract>()(
  "@store/auth-worker/HubRevocation",
) {}

interface RevocableHubs {
  readonly getByName: (organizationId: string) => {
    readonly revoke: (userId: string) => Effect.Effect<unknown, unknown, RuntimeContext>;
  };
}

type RunInBackground = (
  effect: Effect.Effect<void, never, RuntimeContext>,
) => Effect.Effect<void, never, RuntimeContext>;

export const hubRevocationLayer = (hubs: RevocableHubs, runInBackground: RunInBackground) =>
  Layer.succeed(
    HubRevocation,
    HubRevocation.of({
      revoke: (organizationId, userId) =>
        runInBackground(
          Effect.suspend(() => hubs.getByName(organizationId).revoke(userId)).pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logWarning("auth.hub_revoke_failed").pipe(
                Effect.annotateLogs({ organizationId, userId, ...causeDiagnostics(cause) }),
              ),
            ),
          ),
        ),
    }),
  );
