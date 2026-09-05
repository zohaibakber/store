import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const STALE_REPLICA_CODE = "ENTITY_CONFLICT";
const ipcPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

export const InventoryFailureReason = Schema.TaggedUnion({
  transport: {},
  transient: {},
  unauthenticated: {},
  staleReplica: {},
  rejected: { code: Schema.String },
});
export type InventoryFailureReason = typeof InventoryFailureReason.Type;

export class InventoryFailure extends Schema.TaggedError<InventoryFailure>()("InventoryFailure", {
  message: Schema.String,
  reason: InventoryFailureReason,
}) {}

export const isAbortError = (cause: unknown) =>
  (cause instanceof DOMException && cause.name === "AbortError") ||
  (cause instanceof Error && cause.name === "AbortError");

export const humanNetworkMessage = (cause: unknown) => {
  if (cause instanceof Error) {
    const message = cause.message.replace(ipcPrefix, "").trim();
    return message.length > 0 ? message : "Network request failed.";
  }
  return "Network request failed.";
};

export const failureFromUnknown = (cause: unknown): InventoryFailure => {
  if (cause instanceof InventoryFailure) return cause;
  return new InventoryFailure({
    message: humanNetworkMessage(cause),
    reason: { _tag: "transport" },
  });
};

const InventoryErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

export type InventoryHttpPayload = typeof Schema.Json.Type;

export const inventoryFailureFromHttp = (
  status: number,
  payload: InventoryHttpPayload,
  fallback: string,
): InventoryFailure => {
  const envelope = Schema.decodeUnknownOption(InventoryErrorEnvelope)(payload).pipe(
    Option.getOrNull,
  );
  const code = envelope?.error.code?.trim();
  const message =
    envelope?.error.message?.trim() ||
    (Schema.is(Schema.String)(payload) ? payload : "") ||
    fallback;
  if (status === 401) {
    return new InventoryFailure({ message, reason: { _tag: "unauthenticated" } });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new InventoryFailure({ message, reason: { _tag: "transient" } });
  }
  if (code === STALE_REPLICA_CODE) {
    return new InventoryFailure({ message, reason: { _tag: "staleReplica" } });
  }
  return new InventoryFailure({
    message,
    reason: { _tag: "rejected", code: code && code.length > 0 ? code : `HTTP_${status}` },
  });
};
