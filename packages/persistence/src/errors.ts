import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class SyncTransportError extends Schema.TaggedErrorClass<SyncTransportError>()(
  "SyncTransportError",
  { message: Schema.String },
) {}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

export class ProductNotFoundError extends Schema.TaggedErrorClass<ProductNotFoundError>()(
  "ProductNotFoundError",
  { id: Schema.String },
) {}

export class InvoiceNotFoundError extends Schema.TaggedErrorClass<InvoiceNotFoundError>()(
  "InvoiceNotFoundError",
  { id: Schema.String },
) {}

export type StoreError = PersistenceError | ProductNotFoundError | InvoiceNotFoundError;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const persistenceError = (operation: string, cause: unknown) =>
  cause instanceof PersistenceError
    ? cause
    : PersistenceError.make({ operation, message: messageOf(cause) });

export const mapPersistenceError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    effect.pipe(Effect.mapError((cause) => persistenceError(operation, cause)));
