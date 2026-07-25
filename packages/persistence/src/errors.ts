import {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  type StoreError,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export { InvoiceNotFoundError, PersistenceError, ProductNotFoundError, type StoreError };

export class SyncTransportError extends Schema.TaggedErrorClass<SyncTransportError>()(
  "SyncTransportError",
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    status: Schema.optionalKey(Schema.Number),
    code: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

// Reaches the desktop UI, so a bare `String(cause)` — "[object Object]" for
// any thrown non-Error — is not good enough.
const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && cause !== null) {
    const { message } = cause as { message?: unknown };
    if (typeof message === "string" && message.length > 0) return message;
    try {
      const serialized = JSON.stringify(cause);
      if (serialized !== undefined && serialized !== "{}") return serialized;
    } catch {
      // Circular or non-serializable — fall through to String().
    }
  }
  return String(cause);
};

export const persistenceError = (operation: string, cause: unknown) =>
  cause instanceof PersistenceError
    ? cause
    : PersistenceError.make({ operation, message: messageOf(cause), cause });

export const mapPersistenceError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    effect.pipe(Effect.mapError((cause) => persistenceError(operation, cause)));
