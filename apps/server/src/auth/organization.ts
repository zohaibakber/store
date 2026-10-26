import type { AccessClaims } from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";

import type { Actor } from "../authority/engine";
import { Forbidden, Unauthenticated, unauthenticated } from "../http/errors";
import { AccessTokens } from "./access-tokens";
import { authenticateRequest } from "./session";

interface CurrentOrganizationContext extends Actor {
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

export const OrganizationAuthLive = Layer.effect(
  OrganizationAuth,
  Effect.gen(function* () {
    const { verify } = yield* AccessTokens;

    const authenticate = Effect.fn("OrganizationAuth.authenticateCurrentOrganization")(
      function* () {
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
      },
    );

    return Effect.fn("OrganizationAuth.middleware")(function* (httpEffect) {
      const identity = yield* authenticate();
      return yield* httpEffect.pipe(Effect.provideService(CurrentOrganization, identity));
    });
  }),
);
