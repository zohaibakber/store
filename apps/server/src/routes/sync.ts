import {
  MAX_LIVE_IDENTIFIER_LENGTH,
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  SyncRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Hono } from "hono";

import type { AppEnv } from "../http/context";
import { publicError } from "../http/errors";
import { SyncDatabaseError, type SyncProtocolCode, SyncProtocolError } from "../sync/errors";

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

/**
 * A total mapping, so a new protocol code cannot silently default to 400.
 * 500s are server-side faults the client cannot fix by retrying differently.
 */
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

export const syncRoute = new Hono<AppEnv>().post("/", async (c) => {
  const decoded = await Effect.runPromise(
    Effect.tryPromise({
      try: () => c.req.json(),
      catch: () => SyncProtocolError.make({ code: "INVALID_JSON", message: "Invalid JSON body." }),
    }).pipe(
      Effect.flatMap((input) =>
        Schema.decodeUnknownEffect(SyncRequest)(input).pipe(
          Effect.catchTag("SchemaError", (error) =>
            Effect.logWarning("Sync request schema validation failed").pipe(
              Effect.annotateLogs({ validationError: validationMessage(error, input) }),
              Effect.andThen(
                Effect.fail(
                  SyncProtocolError.make({
                    code: "INVALID_SYNC_REQUEST",
                    message: validationMessage(error, input),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
      Effect.result,
    ),
  );
  if (decoded._tag === "Failure")
    return c.json(publicError(decoded.failure.code, decoded.failure.message), 400);

  try {
    const response = await c.var.runSync(
      { organizationId: c.get("organizationId"), userId: c.get("user").id },
      decoded.success,
    );
    return c.json(response);
  } catch (cause) {
    if (cause instanceof SyncProtocolError)
      return c.json(publicError(cause.code, cause.message), protocolStatus[cause.code]);
    if (cause instanceof SyncDatabaseError)
      return c.json(
        publicError("SYNC_UNAVAILABLE", "Synchronization is temporarily unavailable."),
        503,
      );
    console.error("Unhandled sync failure", messageOf(cause));
    return c.json(
      publicError("SYNC_UNAVAILABLE", "Synchronization is temporarily unavailable."),
      503,
    );
  }
});

syncRoute.get("/live", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket")
    return c.json(publicError("INVALID_UPGRADE", "A WebSocket upgrade is required."), 426);
  const organizationId = c.req.query("organizationId");
  const deviceId = c.req.query("deviceId");
  const protocolVersion = c.req.query("protocolVersion");
  if (organizationId !== c.get("organizationId"))
    return c.json(
      publicError("ORGANIZATION_MISMATCH", "The active organization does not match."),
      403,
    );
  if (!deviceId || deviceId.length > MAX_LIVE_IDENTIFIER_LENGTH)
    return c.json(publicError("INVALID_DEVICE", "The sync device id is invalid."), 400);
  if (protocolVersion !== "2")
    return c.json(publicError("UNSUPPORTED_PROTOCOL", "Protocol version 2 is required."), 400);

  return c.var.connectSyncLive({
    organizationId,
    userId: c.get("user").id,
    deviceId,
    authenticationExpiresAt: c.get("session").expiresAt.getTime(),
  });
});
