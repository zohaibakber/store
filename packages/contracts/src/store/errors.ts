import * as Schema from "effect/Schema";

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class ProductNotFoundError extends Schema.TaggedErrorClass<ProductNotFoundError>()(
  "ProductNotFoundError",
  { id: Schema.String },
) {}

export class InvoiceNotFoundError extends Schema.TaggedErrorClass<InvoiceNotFoundError>()(
  "InvoiceNotFoundError",
  { id: Schema.String },
) {}

export const StoreError = Schema.Union([
  PersistenceError,
  ProductNotFoundError,
  InvoiceNotFoundError,
]);
export type StoreError = typeof StoreError.Type;

export const encodeStoreError = Schema.encodeUnknownSync(StoreError);
export const decodeStoreError = Schema.decodeUnknownSync(StoreError);
