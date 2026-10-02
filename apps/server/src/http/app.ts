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
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { OrganizationAuthLive } from "../auth/organization";
import { InventoryCommands, type InventoryCommandsContract } from "../inventory/commands";
import { InventoryImports, type InventoryImportsContract } from "../inventory/imports";
import { InventorySnapshots, type InventorySnapshotsContract } from "../inventory/snapshots";
import { LiveFanout, type LiveFanoutContract } from "../live/fanout";
import { LiveRoutes, type LiveRouteDependencies } from "../live/route";
import { ProductScanHandlers } from "../routes/product-scans";
import { SyncHandlers } from "../routes/sync";
import { UploadHandlers } from "../routes/uploads";
import { StoreApi } from "./api";
import { publicError } from "./errors";
import { ServerRuntime, type ServerRuntimeContract } from "./runtime";
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

const buildOncePerIsolate = <A, E, R>(
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

const workerRuntimeServices = Effect.serviceOption(RuntimeContext).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.die(new Error("Alchemy did not provide the Worker RuntimeContext.")),
      onSome: (runtime) => Effect.succeed(Context.make(RuntimeContext, runtime)),
    }),
  ),
);

export interface WorkerServices {
  readonly runtime: ServerRuntimeContract;
  readonly commands: InventoryCommandsContract;
  readonly snapshots: InventorySnapshotsContract;
  readonly imports: InventoryImportsContract;
  readonly liveFanout: LiveFanoutContract;
  readonly hubs: LiveRouteDependencies["hubs"];
  readonly readLiveHorizon: LiveRouteDependencies["readLiveHorizon"];
}

export const makeWorkerFetch = Effect.fnUntraced(function* (services: WorkerServices) {
  const routes = Layer.mergeAll(
    ApiRoutes,
    Cors,
    LiveRoutes({
      hubs: services.hubs,
      verifyAccessToken: services.runtime.verifyAccessToken,
      readLiveHorizon: services.readLiveHorizon,
    }),
  ).pipe(
    Layer.provide([
      Layer.succeed(ServerRuntime, services.runtime),
      Layer.succeed(InventoryCommands, services.commands),
      Layer.succeed(InventorySnapshots, services.snapshots),
      Layer.succeed(InventoryImports, services.imports),
      Layer.succeed(LiveFanout, services.liveFanout),
      HttpServer.layerServices,
    ]),
  );
  const serveRequest = yield* buildOncePerIsolate(
    HttpRouter.toHttpEffect(routes),
    yield* workerRuntimeServices,
  );
  return recoverUnexpected(serveRequest);
});
