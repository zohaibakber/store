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

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const persistenceError = (operation: string, cause: unknown) =>
  cause instanceof PersistenceError
    ? cause
    : PersistenceError.make({ operation, message: messageOf(cause), cause });

export const mapPersistenceError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    effect.pipe(Effect.mapError((cause) => persistenceError(operation, cause)));
