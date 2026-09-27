import type { AuthSession } from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

import { Forbidden, Unauthenticated, forbidden, unauthenticated } from "../http/errors";
import { ServerRuntime, type ServerRuntimeContract } from "../http/runtime";

export interface CurrentOrganizationContext {
  readonly user: AuthSession["user"];
  readonly session: AuthSession["session"];
  readonly organizationId: string;
  readonly role: AuthSession["organizations"][number]["role"];
}

export class CurrentOrganization extends Context.Service<
  CurrentOrganization,
  CurrentOrganizationContext
>()("@store/server/CurrentOrganization") {}

export class OrganizationAuth extends HttpApiMiddleware.Service<
  OrganizationAuth,
  { requires: RuntimeContext; provides: CurrentOrganization }
>()("@store/server/OrganizationAuth", { error: [Unauthenticated, Forbidden] }) {}

const logAuthFailure = (message: string) =>
  Effect.tapError((cause: unknown) =>
    Effect.logError(message).pipe(
      Effect.annotateLogs({
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
    ),
  );

const authenticateCurrentOrganization = Effect.fn(
  "OrganizationAuth.authenticateCurrentOrganization",
)(function* (runtime: ServerRuntimeContract) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const session = yield* runtime
    .getSession(new Headers(request.headers))
    .pipe(logAuthFailure("Access token verification failed"), Effect.orDie);
  if (!session) return yield* Effect.fail(unauthenticated("UNAUTHENTICATED", "Sign in required."));

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return yield* Effect.fail(forbidden("ORGANIZATION_REQUIRED", "Select an organization first."));
  const membership = session.organizations.find(
    (organization) => organization.id === organizationId,
  );
  if (!membership)
    return yield* Effect.fail(forbidden("ORGANIZATION_REQUIRED", "Select an organization first."));

  return {
    user: session.user,
    session: session.session,
    organizationId,
    role: membership.role,
  } satisfies CurrentOrganizationContext;
});

export const OrganizationAuthLive = Layer.effect(
  OrganizationAuth,
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    return (httpEffect) =>
      Effect.gen(function* () {
        const identity = yield* authenticateCurrentOrganization(runtime);
        return yield* httpEffect.pipe(Effect.provideService(CurrentOrganization, identity));
      });
  }),
);
