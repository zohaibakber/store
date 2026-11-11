import type { AccessTokenVerifier } from "@store/auth";
import {
  bearerFromLiveProtocols,
  LIVE_SOCKET_PATH,
  LiveSocketQuery,
  offeredLiveProtocols,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpHeaders from "effect/http/Headers";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AccessTokens } from "../auth/access-tokens";
import { authenticateToken } from "../auth/session";
import { admissionHeaders, withoutAdmissionHeaders } from "../authority/live-sockets";
import { publicError } from "../http/errors";
import { OrgAuthorities } from "../inventory/organization-authority";

export interface LiveRouteDependencies {
  readonly authorities: {
    readonly getByName: (
      organizationId: string,
    ) => Pick<ReturnType<OrgAuthorities["Service"]["getByName"]>, "fetch">;
  };
  readonly verifyAccessToken: AccessTokenVerifier;
}

const refuse = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe(publicError(code, message), { status });

const decodeQuery = Schema.decodeUnknownOption(LiveSocketQuery);

const queryOf = (request: HttpServerRequest.HttpServerRequest) =>
  decodeQuery(Object.fromEntries(new URL(request.url, "http://live.invalid").searchParams));

const freshUpgradeResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const body = response.body;
  if (response.status !== 101 || body._tag !== "Raw" || !(body.body instanceof Response)) {
    return response;
  }
  const upstream = body.body;
  return HttpServerResponse.setBody(
    HttpServerResponse.empty({ status: 101 }),
    HttpBody.raw(
      new Response(null, {
        status: 101,
        webSocket: upstream.webSocket,
        headers: new Headers(upstream.headers),
      }),
    ),
  );
};

export const liveSocketHandler = Effect.fn("LiveRoutes.socket")(function* (
  dependencies: LiveRouteDependencies,
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (request.headers.upgrade?.toLowerCase() !== "websocket") {
    return refuse(426, "UPGRADE_REQUIRED", "The live channel is a WebSocket.");
  }
  const token = bearerFromLiveProtocols(
    offeredLiveProtocols(request.headers["sec-websocket-protocol"]),
  );
  const claims = yield* authenticateToken(dependencies.verifyAccessToken, token);
  const now = yield* Clock.currentTimeMillis;
  if (claims === null || claims.expiresAt <= now) {
    return refuse(401, "UNAUTHENTICATED", "Sign in required.");
  }
  const organizationId = claims.activeOrganizationId;
  const query = queryOf(request);
  if (Option.isNone(query)) {
    return refuse(400, "INVALID_LIVE_QUERY", "The live channel needs a replica id.");
  }
  const forwarded = request.modify({
    headers: HttpHeaders.fromInput({
      ...withoutAdmissionHeaders(request.headers),
      ...admissionHeaders({
        organizationId,
        replicaId: query.value.replicaId,
        userId: claims.subject,
        expiresAt: claims.expiresAt,
        maxBytes: query.value.maxBytes ?? null,
      }),
    }),
  });
  return yield* dependencies.authorities
    .getByName(organizationId)
    .fetch(forwarded)
    .pipe(
      Effect.map(freshUpgradeResponse),
      Effect.catch(() =>
        Effect.succeed(refuse(503, "LIVE_UNAVAILABLE", "The live channel is unavailable.")),
      ),
    );
});

export const LiveRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const authorities = yield* OrgAuthorities;
    const { verify } = yield* AccessTokens;
    return HttpRouter.add(
      "GET",
      LIVE_SOCKET_PATH,
      liveSocketHandler({ authorities, verifyAccessToken: verify }),
    );
  }),
);
