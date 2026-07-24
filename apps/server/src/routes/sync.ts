import {
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  SyncRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Hono } from "hono";
import type { AppEnv } from "../http/context";
import { publicError } from "../http/errors";
import { SyncDatabaseError, SyncProtocolError } from "../sync/errors";

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

const protocolStatus = (code: string): 400 | 403 | 409 | 422 => {
  if (code === "ORGANIZATION_MISMATCH" || code === "ACTOR_MISMATCH") return 403;
  if (
    code === "CLIENT_SEQUENCE_REUSED" ||
    code === "OPERATION_COLLISION" ||
    code === "OPERATION_ID_REUSED" ||
    code === "IMMUTABLE_ENTITY_REUSED" ||
    code === "ENTITY_CONFLICT"
  )
    return 409;
  if (code === "ENTITY_RELATION_INVALID" || code === "INVALID_ENTITY_ROW") return 422;
  return 400;
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
      return c.json(publicError(cause.code, cause.message), protocolStatus(cause.code));
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
