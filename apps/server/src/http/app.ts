import { isTrustedOrigin } from "@store/auth/security";
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
import { ServerRuntime } from "./runtime";
import { SystemHandlers } from "./system";

const ProtectedHandlers = Layer.mergeAll(SyncHandlers, UploadHandlers, ProductScanHandlers).pipe(
  Layer.provide(OrganizationAuthLive),
);

const ApiRoutes = HttpApiBuilder.layer(StoreApi).pipe(
  Layer.provide(Layer.mergeAll(SystemHandlers, ProtectedHandlers)),
);

const handleAuthRequest = Effect.fn("Server.handleAuthRequest")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const runtime = yield* ServerRuntime;
  // The Worker runtime rebuilds an absolute Request the way Hono's
  // `c.req.raw` did. Passing Effect's path-only URL through toWeb/fromWeb
  // here used to reach Better Auth as `/api/auth/...` and 500.
  return yield* runtime.authFetch(request).pipe(Effect.orDie);
});

const AuthRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/auth/*", handleAuthRequest),
  HttpRouter.add("POST", "/api/auth/*", handleAuthRequest),
);

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    const cors = HttpMiddleware.cors({
      // Matched the way Better Auth matches its own trusted origins, so a
      // wildcard or native-scheme entry is not allowed by the auth origin check
      // and then refused by CORS.
      allowedOrigins: (origin) => isTrustedOrigin(origin, runtime.trustedOrigins),
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

const publicCause = (cause: Cause.Cause<unknown>) => {
  const pretty = Cause.pretty(cause).replace(/\s+/g, " ").trim();
  return pretty.length > 400 ? `${pretty.slice(0, 400)}…` : pretty;
};

export const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      const detail = publicCause(cause);
      return Effect.sync(() => reportError("worker.request_failed", detail)).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            {
              error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "The request could not be handled.",
                detail,
              },
            },
            { status: 500 },
          ),
        ),
      );
    }),
  );
