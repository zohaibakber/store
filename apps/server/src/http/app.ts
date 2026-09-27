import { isTrustedOrigin } from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { OrganizationAuthLive } from "../auth/organization";
import { ProductScanHandlers } from "../routes/product-scans";
import { SyncHandlers } from "../routes/sync";
import { UploadHandlers } from "../routes/uploads";
import { StoreApi } from "./api";
import { publicError } from "./errors";
import { ServerRuntime } from "./runtime";
import { AuthHandlers, SystemHandlers } from "./system";

const ProtectedHandlers = Layer.mergeAll(UploadHandlers, ProductScanHandlers, SyncHandlers).pipe(
  Layer.provide(OrganizationAuthLive),
);

const ApiRoutes = HttpApiBuilder.layer(StoreApi).pipe(
  Layer.provide(Layer.mergeAll(SystemHandlers, AuthHandlers, ProtectedHandlers)),
);

const Cors = HttpRouter.middleware(
  Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    const cors = HttpMiddleware.cors({
      allowedOrigins: (origin) => isTrustedOrigin(origin, runtime.trustedOrigins),
      allowedHeaders: ["Content-Type", "Authorization", "Electron-Origin", "Expo-Origin"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      exposedHeaders: ["Content-Length"],
      maxAge: 600,
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

export const ServerRoutes = Layer.mergeAll(ApiRoutes, Cors);

export const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      return Effect.logError("worker.request_failed").pipe(
        Effect.annotateLogs({ cause: Cause.pretty(cause) }),
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            publicError("INTERNAL_SERVER_ERROR", "Something went wrong."),
            { status: 500 },
          ),
        ),
      );
    }),
  );

/**
 * Builds a router once for the isolate's lifetime.
 *
 * `HttpApiBuilder.group` captures the context it is built in and provides it
 * to every request it later serves, so the build runs on an empty context:
 * handlers capture only the route layers' own services and each request keeps
 * its per-invocation services (request scope, execution context, telemetry).
 * Request-scoped resources such as the Hyperdrive pool memo therefore stay
 * keyed on the request scope. `isolateServices` supplies the few
 * isolate-stable services the build names (the Worker's `RuntimeContext`);
 * the `Scope` is a private isolate scope that is never closed because nothing
 * in the route layers acquires a resource.
 */
export const buildOncePerIsolate = <A, E, R>(
  build: Effect.Effect<A, E, R | Scope.Scope>,
  isolateServices: Context.Context<R>,
) =>
  Effect.gen(function* () {
    const isolateScope = yield* Scope.make();
    return yield* build.pipe(
      Scope.provide(isolateScope),
      Effect.updateContext<never, R>(() => isolateServices),
    );
  });

/**
 * The Worker's isolate-level `RuntimeContext`, read during init.
 *
 * Alchemy runs a Worker's init with its `RuntimeContext` present but keeps it
 * out of the init type (its own cron registration reads it the same way), so
 * requiring it by tag would leak it into the stack's requirements. The router
 * build needs it only to satisfy handler groups that name it; every request
 * still receives the bridge's own copy.
 */
export const workerRuntimeServices = Effect.serviceOption(RuntimeContext).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.die(new Error("Alchemy did not provide the Worker RuntimeContext.")),
      onSome: (runtime) => Effect.succeed(Context.make(RuntimeContext, runtime)),
    }),
  ),
);
