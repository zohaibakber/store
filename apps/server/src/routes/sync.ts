import { SyncRequest } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Hono } from "hono";
import type { AppEnv } from "../http/context";
import { publicError } from "../http/errors";
import { SyncDatabaseError, SyncProtocolError } from "../sync/errors";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

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
      Effect.flatMap(Schema.decodeUnknownEffect(SyncRequest)),
      Effect.mapError((error) =>
        error instanceof SyncProtocolError
          ? error
          : SyncProtocolError.make({
              code: "INVALID_SYNC_REQUEST",
              message: "The sync request is invalid.",
            }),
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
