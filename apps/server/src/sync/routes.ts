import type { AuthSession } from "@store/auth";
import { isTrustedOrigin } from "@store/auth/security";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { AuthError } from "../auth/session";
import type { CatalogNotifications } from "./notifications";

export const notificationRoutes = (
  hubs: Effect.Success<typeof CatalogNotifications>,
  authenticate: (headers: Headers) => Effect.Effect<AuthSession | null, AuthError>,
  trustedOrigins: ReadonlyArray<string>,
) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      yield* router.add(
        "POST",
        "/api/inventory/live-ticket",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const session = yield* authenticate(new Headers(request.headers)).pipe(Effect.orDie);
          const organizationId = session?.session.activeOrganizationId;
          if (
            !session ||
            !organizationId ||
            !session.organizations.some((entry) => entry.id === organizationId)
          ) {
            return HttpServerResponse.empty({ status: 401 });
          }
          const ticket = yield* hubs
            .getByName(organizationId)
            .issueTicket(session.user.id, session.session.expiresAt);
          return HttpServerResponse.jsonUnsafe(
            { ...ticket, organizationId },
            { headers: { "cache-control": "no-store" } },
          );
        }),
      );
      yield* router.add(
        "GET",
        "/api/inventory/live",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const origin = request.headers.origin;
          if (origin && origin !== "null" && !isTrustedOrigin(origin, trustedOrigins))
            return HttpServerResponse.empty({ status: 403 });
          const organizationId = new URL(request.url, "https://sync.invalid").searchParams.get(
            "organizationId",
          );
          if (!organizationId || organizationId.length > 200)
            return HttpServerResponse.empty({ status: 400 });
          return yield* hubs.getByName(organizationId).fetch(request);
        }),
      );
    }),
  );
