import {
  BatchNotFoundError,
  CategoryNotFoundError,
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  type StoreError,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export {
  BatchNotFoundError,
  CategoryNotFoundError,
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  type StoreError,
};

export class SyncTransportError extends Schema.TaggedError<SyncTransportError>()(
  "SyncTransportError",
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    status: Schema.optionalKey(Schema.Number),
    code: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

// Reaches the desktop UI, so a bare `String(cause)` is not good enough.
// Thrown non-Errors become "[object Object]".
const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (Schema.is(Schema.String)(cause)) return cause;
  const details = Schema.decodeUnknownOption(
    Schema.Struct({ message: Schema.optional(Schema.String) }),
  )(cause).pipe(Option.getOrNull);
  if (details) {
    if (details.message) return details.message;
    try {
      const serialized = JSON.stringify(cause);
      if (serialized !== undefined && serialized !== "{}") return serialized;
    } catch {
      // Circular or non-serializable. Fall through to String().
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
