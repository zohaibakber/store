import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const STALE_REPLICA_CODE = "ENTITY_CONFLICT";
const ipcPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

export type InventoryFailureReason =
  | { readonly _tag: "transport" }
  | { readonly _tag: "transient" }
  | { readonly _tag: "unauthenticated" }
  | { readonly _tag: "staleReplica" }
  | { readonly _tag: "rejected"; readonly code: string };

export class InventoryFailure extends Error {
  readonly reason: InventoryFailureReason;

  constructor(input: { readonly message: string; readonly reason: InventoryFailureReason }) {
    super(input.message);
    this.name = "InventoryFailure";
    this.reason = input.reason;
  }
}

export type CatalogUploadDisposition =
  | { readonly _tag: "retry" }
  | { readonly _tag: "skip" }
  | { readonly _tag: "halt" };

export const catalogUploadDisposition = (failure: InventoryFailure): CatalogUploadDisposition => {
  switch (failure.reason._tag) {
    case "staleReplica":
      return { _tag: "skip" };
    case "transport":
    case "transient":
      return { _tag: "retry" };
    case "unauthenticated":
    case "rejected":
      return { _tag: "halt" };
  }
};

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

export const inventoryFailureFromHttp = (
  status: number,
  payload: unknown,
  fallback: string,
): InventoryFailure => {
  const envelope = Schema.decodeUnknownOption(InventoryErrorEnvelope)(payload).pipe(
    Option.getOrNull,
  );
  const code = envelope?.error.code?.trim();
  const message =
    envelope?.error.message?.trim() || (typeof payload === "string" ? payload : "") || fallback;
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
