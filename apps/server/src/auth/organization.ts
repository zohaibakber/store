import type { AccessClaims, AccessTokenVerifier } from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";

import { Forbidden, Unauthenticated, unauthenticated } from "../http/errors";
import { ServerRuntime } from "../http/runtime";
import { authenticateRequest } from "./session";

interface CurrentOrganizationContext {
  readonly organizationId: AccessClaims["activeOrganizationId"];
  readonly userId: AccessClaims["subject"];
  readonly role: AccessClaims["role"];
}

export class CurrentOrganization extends Context.Service<
  CurrentOrganization,
  CurrentOrganizationContext
>()("@store/server/CurrentOrganization") {}

export class OrganizationAuth extends HttpApiMiddleware.Service<
  OrganizationAuth,
  { requires: RuntimeContext; provides: CurrentOrganization }
>()("@store/server/OrganizationAuth", { error: [Unauthenticated, Forbidden] }) {}

const authenticateCurrentOrganization = Effect.fn(
  "OrganizationAuth.authenticateCurrentOrganization",
)(function* (verify: AccessTokenVerifier) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const claims = yield* authenticateRequest(verify, request);
  if (claims === null) {
    return yield* Effect.fail(unauthenticated("UNAUTHENTICATED", "Sign in required."));
  }
  return {
    organizationId: claims.activeOrganizationId,
    userId: claims.subject,
    role: claims.role,
  } satisfies CurrentOrganizationContext;
});

export const OrganizationAuthLive = Layer.effect(
  OrganizationAuth,
  Effect.gen(function* () {
    const { verifyAccessToken } = yield* ServerRuntime;
    return (httpEffect) =>
      Effect.gen(function* () {
        const identity = yield* authenticateCurrentOrganization(verifyAccessToken);
        return yield* httpEffect.pipe(Effect.provideService(CurrentOrganization, identity));
      });
  }),
);
