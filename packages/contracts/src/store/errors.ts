import * as Schema from "effect/Schema";

export class PersistenceError extends Schema.TaggedError<PersistenceError>()("PersistenceError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  "ProductNotFoundError",
  { id: Schema.String },
) {}

export class BatchNotFoundError extends Schema.TaggedError<BatchNotFoundError>()(
  "BatchNotFoundError",
  { id: Schema.String },
) {}

export class CategoryNotFoundError extends Schema.TaggedError<CategoryNotFoundError>()(
  "CategoryNotFoundError",
  { id: Schema.String },
) {}

export class InvoiceNotFoundError extends Schema.TaggedError<InvoiceNotFoundError>()(
  "InvoiceNotFoundError",
  { id: Schema.String },
) {}

export const StoreError = Schema.Union([
  PersistenceError,
  ProductNotFoundError,
  BatchNotFoundError,
  CategoryNotFoundError,
  InvoiceNotFoundError,
]);
export type StoreError = typeof StoreError.Type;

export const encodeStoreError = Schema.encodeUnknownSync(StoreError);
export const decodeStoreError = Schema.decodeUnknownSync(StoreError);
