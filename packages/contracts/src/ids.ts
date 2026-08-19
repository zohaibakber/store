import * as Schema from "effect/Schema";

const NonEmptyId = Schema.String.check(Schema.isMinLength(1));

export const CategoryId = NonEmptyId.pipe(Schema.brand("CategoryId"));
export type CategoryId = typeof CategoryId.Type;
export const decodeCategoryId = Schema.decodeUnknownSync(CategoryId);

export const ProductId = NonEmptyId.pipe(Schema.brand("ProductId"));
export type ProductId = typeof ProductId.Type;
export const decodeProductId = Schema.decodeUnknownSync(ProductId);

export const BatchId = NonEmptyId.pipe(Schema.brand("BatchId"));
export type BatchId = typeof BatchId.Type;
export const decodeBatchId = Schema.decodeUnknownSync(BatchId);

export const InvoiceId = NonEmptyId.pipe(Schema.brand("InvoiceId"));
export type InvoiceId = typeof InvoiceId.Type;
export const decodeInvoiceId = Schema.decodeUnknownSync(InvoiceId);

export const InvoiceItemId = NonEmptyId.pipe(Schema.brand("InvoiceItemId"));
export type InvoiceItemId = typeof InvoiceItemId.Type;
export const decodeInvoiceItemId = Schema.decodeUnknownSync(InvoiceItemId);

export const OrganizationId = NonEmptyId.pipe(Schema.brand("OrganizationId"));
export type OrganizationId = typeof OrganizationId.Type;
export const decodeOrganizationId = Schema.decodeUnknownSync(OrganizationId);

export const UserId = NonEmptyId.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;
export const decodeUserId = Schema.decodeUnknownSync(UserId);
