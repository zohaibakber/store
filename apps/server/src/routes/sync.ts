import {
  MAX_LIVE_IDENTIFIER_LENGTH,
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  SyncRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import {
  badRequest,
  conflict,
  forbidden,
  internalServerError,
  serviceUnavailable,
  unprocessableEntity,
  upgradeRequired,
} from "../http/errors";
import { ServerRuntime } from "../http/runtime";
import { type SyncProtocolCode, SyncProtocolError } from "../sync/errors";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const requestSizeFailure = (input: unknown) => {
  if (typeof input !== "object" || input === null) return undefined;
  const operations = Reflect.get(input, "operations");
  if (!Array.isArray(operations)) return undefined;
  if (operations.length > MAX_SYNC_OPERATIONS_PER_REQUEST)
    return `operations contains ${operations.length} items; at most ${MAX_SYNC_OPERATIONS_PER_REQUEST} are allowed`;
  for (const [index, operation] of operations.entries()) {
    if (typeof operation !== "object" || operation === null) continue;
    const changes = Reflect.get(operation, "changes");
    if (Array.isArray(changes) && changes.length > MAX_SYNC_CHANGES_PER_OPERATION)
      return `operations[${index}].changes contains ${changes.length} items; at most ${MAX_SYNC_CHANGES_PER_OPERATION} are allowed`;
  }
  return undefined;
};

const validationMessage = (cause: unknown, input: unknown) => {
  const reason = requestSizeFailure(input) ?? messageOf(cause).split(", got ")[0];
  return `Sync request validation failed: ${reason}`.slice(0, 1_000);
};

const protocolStatus: Record<SyncProtocolCode, 400 | 403 | 409 | 422 | 500> = {
  INVALID_JSON: 400,
  INVALID_SYNC_REQUEST: 400,
  INVALID_DEVICE: 400,
  INVALID_CURSOR: 400,
  INVALID_OPERATION: 400,
  INVALID_OCCURRED_AT: 400,
  INVALID_PAYLOAD_HASH: 400,
  INVALID_CLIENT_SEQUENCE: 400,
  INVALID_ENTITY_ID: 400,
  INVALID_ROW_VERSION: 400,
  EMPTY_OPERATION: 400,
  TOO_MANY_OPERATIONS: 400,
  TOO_MANY_CHANGES: 400,
  ORGANIZATION_MISMATCH: 403,
  ACTOR_MISMATCH: 403,
  DEVICE_MISMATCH: 403,
  CLIENT_SEQUENCE_REUSED: 409,
  OPERATION_COLLISION: 409,
  OPERATION_ID_REUSED: 409,
  DUPLICATE_OPERATION: 409,
  IMMUTABLE_ENTITY: 409,
  IMMUTABLE_ENTITY_REUSED: 409,
  ENTITY_CONFLICT: 409,
  ENTITY_RELATION_INVALID: 422,
  ENTITY_ID_MISMATCH: 422,
  INVALID_ENTITY_ROW: 422,
  BATCH_NOT_FOUND: 422,
  PAYLOAD_HASH_MISMATCH: 422,
  ENTITY_WRITE_FAILED: 500,
  CHANGE_LOG_FAILED: 500,
};

const protocolFailure = (error: SyncProtocolError) => {
  switch (protocolStatus[error.code]) {
    case 400:
      return badRequest(error.code, error.message);
    case 403:
      return forbidden(error.code, error.message);
    case 409:
      return conflict(error.code, error.message);
    case 422:
      return unprocessableEntity(error.code, error.message);
    case 500:
      return internalServerError(error.code, error.message);
  }
};

const decodeSyncRequest = (request: HttpServerRequest.HttpServerRequest) =>
  request.text.pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: () =>
          SyncProtocolError.make({ code: "INVALID_JSON", message: "Invalid JSON body." }),
      }),
    ),
    Effect.flatMap((input) =>
      Schema.decodeUnknownEffect(SyncRequest)(input).pipe(
        Effect.catchTag("SchemaError", (error) => {
          const message = validationMessage(error, input);
          return Effect.logWarning("Sync request schema validation failed").pipe(
            Effect.annotateLogs({ validationError: message }),
            Effect.andThen(
              Effect.fail(SyncProtocolError.make({ code: "INVALID_SYNC_REQUEST", message })),
            ),
          );
        }),
      ),
    ),
    Effect.catchTag("HttpServerError", () =>
      Effect.fail(SyncProtocolError.make({ code: "INVALID_JSON", message: "Invalid JSON body." })),
    ),
  );

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers
      .handleRaw(
        "exchange",
        Effect.fn(function* ({ request }) {
          const identity = yield* CurrentOrganization;
          const input = yield* decodeSyncRequest(request).pipe(
            Effect.mapError((error) => badRequest(error.code, error.message)),
          );
          return yield* runtime
            .runSync({ organizationId: identity.organizationId, userId: identity.user.id }, input)
            .pipe(
              Effect.catchTags({
                SyncProtocolError: (error) => Effect.fail(protocolFailure(error)),
                SyncDatabaseError: () =>
                  Effect.fail(
                    serviceUnavailable(
                      "SYNC_UNAVAILABLE",
                      "Synchronization is temporarily unavailable.",
                    ),
                  ),
              }),
            );
        }),
      )
      .handle(
        "live",
        Effect.fn(function* ({ query, request }) {
          const identity = yield* CurrentOrganization;
          if (request.headers.upgrade?.toLowerCase() !== "websocket")
            return yield* Effect.fail(
              upgradeRequired("INVALID_UPGRADE", "A WebSocket upgrade is required."),
            );
          if (query.organizationId !== identity.organizationId)
            return yield* Effect.fail(
              forbidden("ORGANIZATION_MISMATCH", "The active organization does not match."),
            );
          if (!query.deviceId || query.deviceId.length > MAX_LIVE_IDENTIFIER_LENGTH)
            return yield* Effect.fail(
              badRequest("INVALID_DEVICE", "The sync device id is invalid."),
            );
          if (query.protocolVersion !== "2")
            return yield* Effect.fail(
              badRequest("UNSUPPORTED_PROTOCOL", "Protocol version 2 is required."),
            );

          return yield* runtime
            .connectSyncLive({
              organizationId: identity.organizationId,
              userId: identity.user.id,
              deviceId: query.deviceId,
              authenticationExpiresAt: identity.session.expiresAt.getTime(),
            })
            .pipe(Effect.orDie);
        }),
      );
  }),
);
