import * as Schema from "effect/Schema";

export const CategoryId = Schema.NonEmptyString.pipe(Schema.brand("CategoryId"));
export type CategoryId = typeof CategoryId.Type;
export const decodeCategoryId = Schema.decodeUnknownSync(CategoryId);

export const ProductId = Schema.NonEmptyString.pipe(Schema.brand("ProductId"));
export type ProductId = typeof ProductId.Type;
export const decodeProductId = Schema.decodeUnknownSync(ProductId);

export const BatchId = Schema.NonEmptyString.pipe(Schema.brand("BatchId"));
export type BatchId = typeof BatchId.Type;
export const decodeBatchId = Schema.decodeUnknownSync(BatchId);

export const InvoiceId = Schema.NonEmptyString.pipe(Schema.brand("InvoiceId"));
export type InvoiceId = typeof InvoiceId.Type;
export const decodeInvoiceId = Schema.decodeUnknownSync(InvoiceId);

export const InvoiceItemId = Schema.NonEmptyString.pipe(Schema.brand("InvoiceItemId"));
export type InvoiceItemId = typeof InvoiceItemId.Type;
export const decodeInvoiceItemId = Schema.decodeUnknownSync(InvoiceItemId);

export const OrganizationId = Schema.NonEmptyString.pipe(Schema.brand("OrganizationId"));
export type OrganizationId = typeof OrganizationId.Type;
export const decodeOrganizationId = Schema.decodeUnknownSync(OrganizationId);

export const UserId = Schema.NonEmptyString.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;
export const decodeUserId = Schema.decodeUnknownSync(UserId);
