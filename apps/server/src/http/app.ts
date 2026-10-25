import { isTrustedOrigin } from "@store/auth/security";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { AccessTokens } from "../auth/access-tokens";
import { OrganizationAuthLive } from "../auth/organization";
import { GlobalSearch } from "../global-search/service";
import { OrganizationAuthority } from "../inventory/organization-authority";
import { InvoiceExtraction } from "../invoice-extraction/service";
import { LiveFanout } from "../live/fanout";
import { OrgHubs } from "../live/org-hubs";
import { LiveRoutes } from "../live/route";
import { GlobalSearchHandlers } from "../routes/global-search";
import { SyncHandlers } from "../routes/sync";
import { UploadHandlers } from "../routes/uploads";
import { buildOncePerIsolate, workerRuntimeServices } from "../runtime/isolate";
import { StoreApi } from "./api";
import { publicError } from "./errors";
import { AuthHandlers, SystemHandlers } from "./system";

const ProtectedHandlers = Layer.mergeAll(UploadHandlers, GlobalSearchHandlers, SyncHandlers).pipe(
  Layer.provide(OrganizationAuthLive),
);

const ApiRoutes = HttpApiBuilder.layer(StoreApi).pipe(
  Layer.provide(Layer.mergeAll(SystemHandlers, AuthHandlers, ProtectedHandlers)),
);

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const { trustedOrigins } = yield* AccessTokens;
    const cors = HttpMiddleware.cors({
      allowedOrigins: (origin) => isTrustedOrigin(origin, trustedOrigins),
      allowedHeaders: ["Content-Type", "Authorization", "traceparent", "b3"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      exposedHeaders: ["Content-Length"],
      maxAge: 7200,
      credentials: true,
    });
    return (httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        if (!request.url.startsWith("/api")) return httpEffect;
        return cors(httpEffect);
      });
  }),
  { global: true },
);

const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      return HttpServerError.causeResponse(cause).pipe(
        Effect.flatMap(([response]) =>
          response.status < 500
            ? Effect.succeed(response)
            : Effect.logError("worker.request_failed").pipe(
                Effect.annotateLogs({ cause: Cause.pretty(cause) }),
                Effect.as(
                  HttpServerResponse.jsonUnsafe(
                    publicError("INTERNAL_SERVER_ERROR", "Something went wrong."),
                    { status: 500 },
                  ),
                ),
              ),
        ),
      );
    }),
  );

export type ApiServices =
  | AccessTokens
  | GlobalSearch
  | InvoiceExtraction
  | LiveFanout
  | OrgHubs
  | OrganizationAuthority;

export const makeWorkerFetch = Effect.gen(function* () {
  const services = yield* Effect.context<ApiServices>();
  const routes = Layer.mergeAll(ApiRoutes, Cors, LiveRoutes).pipe(
    Layer.provide([Layer.succeedContext(services), HttpServer.layerServices]),
  );
  const serveRequest = yield* buildOncePerIsolate(
    HttpRouter.toHttpEffect(routes),
    yield* workerRuntimeServices,
  );
  return recoverUnexpected(serveRequest);
});
