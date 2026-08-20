import { MAX_LIVE_IDENTIFIER_LENGTH } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import { badRequest, forbidden, upgradeRequired } from "../http/errors";
import { ServerRuntime } from "../http/runtime";

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers.handle(
      "live",
      Effect.fn(function* ({ query, request }) {
        const identity = yield* CurrentOrganization;
        if (request.headers.upgrade?.toLowerCase() !== "websocket")
          return yield* Effect.fail(
            upgradeRequired("INVALID_UPGRADE", "A WebSocket upgrade is required."),
          );
        if (query.organizationId && query.organizationId !== identity.organizationId)
          return yield* Effect.fail(
            forbidden("ORGANIZATION_MISMATCH", "The active organization does not match."),
          );
        if (!query.deviceId || query.deviceId.length > MAX_LIVE_IDENTIFIER_LENGTH)
          return yield* Effect.fail(badRequest("INVALID_DEVICE", "The sync device id is invalid."));
        if (query.protocolVersion !== undefined && query.protocolVersion !== "2")
          return yield* Effect.fail(
            badRequest("UNSUPPORTED_PROTOCOL", "Protocol version 2 is required."),
          );

        return yield* runtime
          .connectSyncLive({
            organizationId: identity.organizationId,
            userId: identity.user.id,
            deviceId: query.deviceId,
            authenticationExpiresAt: identity.session.expiresAt,
          })
          .pipe(Effect.orDie);
      }),
    );
  }),
);
