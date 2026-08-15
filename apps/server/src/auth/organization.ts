import type { AuthSession } from "@store/auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

import { Forbidden, Unauthenticated, forbidden, unauthenticated } from "../http/errors";
import { ServerRuntime } from "../http/runtime";

export interface CurrentOrganizationShape {
  readonly user: AuthSession["user"];
  readonly session: AuthSession["session"];
  readonly organizationId: string;
}

export class CurrentOrganization extends Context.Service<
  CurrentOrganization,
  CurrentOrganizationShape
>()("@store/server/CurrentOrganization") {}

export const authHeadersForRequest = (requestHeaders: Headers) => {
  const origin = requestHeaders.get("origin");
  if (origin && origin !== "null") return requestHeaders;

  const nativeOrigin = requestHeaders.get("expo-origin") ?? requestHeaders.get("electron-origin");
  if (!nativeOrigin) return requestHeaders;

  const authHeaders = new Headers(requestHeaders);
  authHeaders.set("origin", nativeOrigin);
  return authHeaders;
};

export class OrganizationAuth extends HttpApiMiddleware.Service<
  OrganizationAuth,
  { requires: import("alchemy").RuntimeContext; provides: CurrentOrganization }
>()("@store/server/OrganizationAuth", { error: [Unauthenticated, Forbidden] }) {}

const logAuthFailure = (message: string) =>
  Effect.tapError((cause: unknown) =>
    Effect.logError(message).pipe(
      Effect.annotateLogs({
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
    ),
  );

export const OrganizationAuthLive = Layer.effect(
  OrganizationAuth,
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers = authHeadersForRequest(new Headers(request.headers));
        const session = yield* runtime
          .getSession(headers)
          .pipe(logAuthFailure("Clerk session lookup failed"), Effect.orDie);
        if (!session)
          return yield* Effect.fail(
            unauthenticated("UNAUTHENTICATED", "Authentication is required."),
          );

        const organizationId = session.session.activeOrganizationId;
        if (!organizationId)
          return yield* Effect.fail(
            forbidden("ORGANIZATION_REQUIRED", "Select an organization first."),
          );

        const hasActiveMember = yield* runtime
          .hasActiveMember(headers)
          .pipe(logAuthFailure("Clerk organization lookup failed"), Effect.orDie);
        if (!hasActiveMember)
          return yield* Effect.fail(
            forbidden("ORGANIZATION_ACCESS_DENIED", "Organization access is denied."),
          );

        return yield* httpEffect.pipe(
          Effect.provideService(CurrentOrganization, {
            user: session.user,
            session: session.session,
            organizationId,
          }),
        );
      });
  }),
);
