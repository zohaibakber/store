import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { OrganizationAuthLive } from "../auth/organization";
import { ProductScanHandlers } from "../routes/product-scans";
import { SyncHandlers } from "../routes/sync";
import { UploadHandlers } from "../routes/uploads";
import { reportError } from "../runtime/worker";
import { StoreApi } from "./api";
import { publicError } from "./errors";
import { ServerRuntime } from "./runtime";
import { SystemHandlers } from "./system";

const ProtectedHandlers = Layer.mergeAll(SyncHandlers, UploadHandlers, ProductScanHandlers).pipe(
  Layer.provide(OrganizationAuthLive),
);

const ApiRoutes = HttpApiBuilder.layer(StoreApi).pipe(
  Layer.provide(Layer.mergeAll(SystemHandlers, ProtectedHandlers)),
);

const handleSessionRequest = Effect.fn("Server.handleSessionRequest")(function* () {
  const runtime = yield* ServerRuntime;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const snapshot = yield* runtime.loadWorkspace(new Headers(webRequest.headers)).pipe(Effect.orDie);
  return HttpServerResponse.jsonUnsafe(snapshot);
});

const AuthRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/auth/session", handleSessionRequest),
  HttpRouter.add("GET", "/api/auth/get-session", handleSessionRequest),
);

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    const cors = HttpMiddleware.cors({
      allowedOrigins: (origin) =>
        runtime.trustedOrigins.includes(origin) ||
        (runtime.trustedOrigins.includes("exp://*") && origin.startsWith("exp://")),
      allowedHeaders: ["Content-Type", "Authorization"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      exposedHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    });
    return (httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
        // Effect stores `url` without scheme/host. `new URL(originalUrl)`
        // throws TypeError: Invalid URL string on Cloudflare when that value
        // is a path rather than an absolute URL.
        request.url.startsWith("/api") ? cors(httpEffect) : httpEffect,
      );
  }),
  { global: true },
);

export const ServerRoutes = Layer.mergeAll(ApiRoutes, AuthRoutes, Cors);

export const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      return Effect.sync(() => reportError("worker.request_failed", Cause.pretty(cause))).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            publicError("INTERNAL_SERVER_ERROR", "The request could not be handled."),
            { status: 500 },
          ),
        ),
      );
    }),
  );
