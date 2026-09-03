import { isTrustedOrigin } from "@store/auth";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { OrganizationAuthLive } from "../auth/organization";
import { InventoryMutationHandlers } from "../routes/inventory-mutations";
import { ProductScanHandlers } from "../routes/product-scans";
import { UploadHandlers } from "../routes/uploads";
import { reportError } from "../runtime/worker";
import { StoreApi } from "./api";
import { publicError } from "./errors";
import { ServerRuntime } from "./runtime";
import { SystemHandlers } from "./system";

const ProtectedHandlers = Layer.mergeAll(
  UploadHandlers,
  ProductScanHandlers,
  InventoryMutationHandlers,
).pipe(Layer.provide(OrganizationAuthLive));

const ApiRoutes = HttpApiBuilder.layer(StoreApi).pipe(
  Layer.provide(Layer.mergeAll(SystemHandlers, ProtectedHandlers)),
);

const RawRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    const handleSessionRequest = Effect.fn("Server.handleSessionRequest")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const snapshot = yield* runtime
        .loadWorkspace(new Headers(request.headers))
        .pipe(Effect.orDie);
      return HttpServerResponse.jsonUnsafe(snapshot);
    });

    yield* router.add("GET", "/api/auth/session", handleSessionRequest);
    yield* router.add("GET", "/api/auth/get-session", handleSessionRequest);
  }),
);

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    const cors = HttpMiddleware.cors({
      // Matched the way trusted origins are classified, so a wildcard or
      // native-scheme entry is not allowed by CORS and then refused elsewhere.
      allowedOrigins: (origin) => isTrustedOrigin(origin, runtime.trustedOrigins),
      allowedHeaders: ["Content-Type", "Authorization", "Electron-Origin", "Expo-Origin"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      exposedHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    });
    return (httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        // Effect stores `url` without scheme/host. `new URL(originalUrl)`
        // throws TypeError: Invalid URL string on Cloudflare when that value
        // is a path rather than an absolute URL.
        if (!request.url.startsWith("/api")) return httpEffect;
        return cors(httpEffect);
      });
  }),
  { global: true },
);

export const ServerRoutes = Layer.mergeAll(ApiRoutes, RawRoutes, Cors);

export const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      return Effect.sync(() => reportError("worker.request_failed", Cause.pretty(cause))).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            publicError("INTERNAL_SERVER_ERROR", "Something went wrong."),
            { status: 500 },
          ),
        ),
      );
    }),
  );
