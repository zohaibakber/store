import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { AccessTokens } from "../auth/access-tokens";
import { authenticateRequest, workspaceSnapshotOf } from "../auth/session";
import { StoreApi } from "./api";

export const SystemHandlers = HttpApiBuilder.group(StoreApi, "system", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ ok: true })),
);

export const AuthHandlers = HttpApiBuilder.group(
  StoreApi,
  "auth",
  Effect.fn("AuthHandlers.make")(function* (handlers) {
    const { verify } = yield* AccessTokens;
    const session = Effect.fn("AuthHandlers.session")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return workspaceSnapshotOf(yield* authenticateRequest(verify, request));
    });
    return handlers.handle("session", session);
  }),
);
