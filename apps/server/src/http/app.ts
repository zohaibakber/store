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

import { OrganizationAuthLive } from "../auth/organization";
import { InventoryCommands, type InventoryCommandsContract } from "../inventory/commands";
import { InventoryDevices, type InventoryDevicesContract } from "../inventory/devices";
import { InventoryImports, type InventoryImportsContract } from "../inventory/imports";
import { InventorySnapshots, type InventorySnapshotsContract } from "../inventory/snapshots";
import { LiveFanout, type LiveFanoutContract } from "../live/fanout";
import { LiveRoutes, type LiveRouteDependencies } from "../live/route";
import { GlobalSearchHandlers } from "../routes/global-search";
import { ProductScanHandlers } from "../routes/product-scans";
import { SyncHandlers } from "../routes/sync";
import { UploadHandlers } from "../routes/uploads";
import { buildOncePerIsolate, workerRuntimeServices } from "../runtime/isolate";
import { StoreApi } from "./api";
import { publicError } from "./errors";
import { ServerRuntime, type ServerRuntimeContract } from "./runtime";
import { AuthHandlers, SystemHandlers } from "./system";

const ProtectedHandlers = Layer.mergeAll(
  UploadHandlers,
  ProductScanHandlers,
  GlobalSearchHandlers,
  SyncHandlers,
).pipe(Layer.provide(OrganizationAuthLive));

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

export interface WorkerServices {
  readonly runtime: ServerRuntimeContract;
  readonly commands: InventoryCommandsContract;
  readonly snapshots: InventorySnapshotsContract;
  readonly imports: InventoryImportsContract;
  readonly devices: InventoryDevicesContract;
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
      Layer.succeed(InventoryDevices, services.devices),
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
