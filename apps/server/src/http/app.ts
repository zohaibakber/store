import { isTrustedOrigin } from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
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

export const ServerRoutes = Layer.mergeAll(ApiRoutes, Cors);

export const recoverUnexpected = <E, R>(
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

export const buildOncePerIsolate = <A, E, R>(
  build: Effect.Effect<A, E, R | Scope.Scope>,
  isolateServices: Context.Context<R>,
) =>
  Effect.gen(function* () {
    const isolateScope = yield* Scope.make();
    return yield* build.pipe(
      Scope.provide(isolateScope),
      Effect.onError((cause) => Scope.close(isolateScope, Exit.failCause(cause))),
      Effect.updateContext<never, R>(() => isolateServices),
    );
  });

export const workerRuntimeServices = Effect.serviceOption(RuntimeContext).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.die(new Error("Alchemy did not provide the Worker RuntimeContext.")),
      onSome: (runtime) => Effect.succeed(Context.make(RuntimeContext, runtime)),
    }),
  ),
);
