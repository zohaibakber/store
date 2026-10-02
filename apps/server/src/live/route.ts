import type { AccessTokenVerifier } from "@store/auth";
import {
  bearerFromLiveProtocols,
  LIVE_SOCKET_PATH,
  LiveSocketQuery,
  offeredLiveProtocols,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpHeaders from "effect/http/Headers";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpRouter from "effect/http/HttpRouter";
import type { HttpServerError } from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { authenticateToken } from "../auth/session";
import { publicError } from "../http/errors";
import type { InventoryError } from "../inventory/errors";
import type { LiveHorizon } from "../inventory/live-horizon";
import type { InventoryActor } from "../inventory/model";
import { admissionHeaders, withoutAdmissionHeaders } from "./hub-core";

interface OrgHubFetcher {
  readonly getByName: (organizationId: string) => {
    readonly fetch: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, HttpServerError>;
  };
}

export interface LiveRouteDependencies {
  readonly hubs: OrgHubFetcher;
  readonly verifyAccessToken: AccessTokenVerifier;
  readonly readLiveHorizon: (
    actor: InventoryActor,
    replicaId: string,
  ) => Effect.Effect<LiveHorizon, InventoryError, RuntimeContext>;
}

const refuse = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe(publicError(code, message), { status });

const decodeQuery = Schema.decodeUnknownOption(LiveSocketQuery);

const queryOf = (request: HttpServerRequest.HttpServerRequest) =>
  decodeQuery(Object.fromEntries(new URL(request.url, "http://live.invalid").searchParams));

const horizonFailure = (error: InventoryError) =>
  error._tag !== "SyncProtocolError"
    ? refuse(503, "SYNC_UNAVAILABLE", "Organization sync is temporarily unavailable.")
    : error.code === "REPLICA_OWNED_BY_OTHER"
      ? refuse(403, error.code, error.message)
      : refuse(409, error.code, error.message);

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

export const liveSocketHandler = Effect.fnUntraced(function* (dependencies: LiveRouteDependencies) {
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
  const horizon = yield* dependencies
    .readLiveHorizon({ organizationId, userId: claims.subject }, query.value.replicaId)
    .pipe(Effect.result);
  if (Result.isFailure(horizon)) return horizonFailure(horizon.failure);
  const forwarded = request.modify({
    headers: HttpHeaders.fromInput({
      ...withoutAdmissionHeaders(request.headers),
      ...admissionHeaders({
        replicaId: query.value.replicaId,
        userId: claims.subject,
        expiresAt: claims.expiresAt,
        maxBytes: query.value.maxBytes ?? null,
        epoch: horizon.success.epoch,
        horizon: horizon.success.horizon,
      }),
    }),
  });
  return yield* dependencies.hubs
    .getByName(organizationId)
    .fetch(forwarded)
    .pipe(
      Effect.map(freshUpgradeResponse),
      Effect.catch(() =>
        Effect.succeed(refuse(503, "LIVE_UNAVAILABLE", "The live channel is unavailable.")),
      ),
    );
});

export const LiveRoutes = (dependencies: LiveRouteDependencies) =>
  HttpRouter.add("GET", LIVE_SOCKET_PATH, liveSocketHandler(dependencies));
