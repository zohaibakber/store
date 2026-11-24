import { SyncBadRequest } from "@store/contracts/sync/api";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { AccessTokens } from "../auth/access-tokens";
import { OrganizationAuthLive } from "../auth/organization";
import { OrgAuthorities, OrganizationAuthority } from "../inventory/organization-authority";
import { LiveRoutes } from "../live/route";
import { SyncHandlers } from "../routes/sync";
import { buildOncePerIsolate, workerRuntimeServices } from "../runtime/isolate";
import { MalformedRequest, StoreApi } from "./api";
import { publicError } from "./errors";
import { AuthHandlers, SystemHandlers } from "./system";

const malformedRequest = SyncBadRequest.make(
  publicError("INVALID_REQUEST", "The request is not valid. Update the app and try again."),
);

const MalformedRequestLive = HttpApiMiddleware.layerSchemaErrorTransform(
  MalformedRequest,
  (error, { endpoint }) => {
    switch (error.kind) {
      case "Params":
      case "Headers":
      case "Query":
      case "Payload":
        return Effect.logWarning("worker.malformed_request").pipe(
          Effect.annotateLogs({ endpoint: endpoint.identifier, part: error.kind }),
          Effect.andThen(Effect.fail(malformedRequest)),
        );
      case "Body":
      case "ResponseHeaders":
        return Effect.fail(error);
      default: {
        const _exhaustive: never = error.kind;
        return _exhaustive;
      }
    }
  },
);

const ProtectedHandlers = SyncHandlers.pipe(Layer.provide(OrganizationAuthLive));

const ApiRoutes = HttpApiBuilder.layer(StoreApi).pipe(
  Layer.provide(
    Layer.mergeAll(SystemHandlers, AuthHandlers, ProtectedHandlers).pipe(
      Layer.provide(MalformedRequestLive),
    ),
  ),
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

export type ApiServices = AccessTokens | OrgAuthorities | OrganizationAuthority;

export const makeWorkerFetch = Effect.gen(function* () {
  const services = yield* Effect.context<ApiServices>();
  const routes = Layer.mergeAll(ApiRoutes, LiveRoutes).pipe(
    Layer.provide([Layer.succeedContext(services), HttpServer.layerServices]),
  );
  const serveRequest = yield* buildOncePerIsolate(
    HttpRouter.toHttpEffect(routes),
    yield* workerRuntimeServices,
  );
  return recoverUnexpected(serveRequest);
});
