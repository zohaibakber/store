import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { authenticateRequest, workspaceSnapshotOf } from "../auth/session";
import { StoreApi } from "./api";
import { ServerRuntime } from "./runtime";

export const SystemHandlers = HttpApiBuilder.group(StoreApi, "system", (handlers) =>
  handlers
    .handle("landing", () =>
      Effect.succeed({
        service: "Store Invoice API" as const,
        endpoints: [
          "/api/health",
          "/api/auth/*",
          "/api/sync/*",
          "/api/uploads",
          "/api/product-scans",
        ],
      }),
    )
    .handle("status", () => Effect.succeed({ service: "Store Invoice API" as const, ok: true }))
    .handle("health", () => Effect.succeed({ ok: true })),
);

export const AuthHandlers = HttpApiBuilder.group(
  StoreApi,
  "auth",
  Effect.fn("AuthHandlers.make")(function* (handlers) {
    const { verifyAccessToken } = yield* ServerRuntime;
    const session = Effect.fn("AuthHandlers.session")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return workspaceSnapshotOf(yield* authenticateRequest(verifyAccessToken, request));
    });
    return handlers.handle("session", session);
  }),
);
