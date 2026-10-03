import * as Schema from "effect/Schema";

import { PositiveInt } from "../schema-primitives";

export const MAX_INVOICE_UPLOAD_FILES = 10;
export const MAX_INVOICE_UPLOAD_BYTES = 20 * 1024 * 1024;

export const invoiceUploadRejection = (
  files: ReadonlyArray<{ readonly byteLength: number }>,
): string | null => {
  if (files.length === 0) return "Attach at least one invoice file.";
  if (files.length > MAX_INVOICE_UPLOAD_FILES) {
    return `Attach at most ${MAX_INVOICE_UPLOAD_FILES} invoice files.`;
  }
  const total = files.reduce((sum, file) => sum + file.byteLength, 0);
  if (total > MAX_INVOICE_UPLOAD_BYTES) return "The attachments are too large.";
  return null;
};

const nonNegativeInteger = (description: string) => Schema.Natural.annotate({ description });

const positiveInteger = (description: string) => PositiveInt.annotate({ description });

export const InvoiceExtractionLine = Schema.Struct({
  name: Schema.String.annotate({ description: "Product name printed on the invoice line." }),
  batchNumber: Schema.NullOr(Schema.String).annotate({
    description: "Batch or lot number, or null when absent.",
  }),
  expiresAt: Schema.NullOr(Schema.String).annotate({
    description: "Expiry date as DD-MM-YYYY, or null.",
  }),
  packQuantity: nonNegativeInteger("Whole packs received."),
  unitQuantity: nonNegativeInteger("Loose units received beyond whole packs."),
  unitsPerPack: positiveInteger("Units contained in one sealed pack."),
  packPrice: Schema.NullOr(nonNegativeInteger("Price of one pack in the smallest currency unit.")),
});
export interface InvoiceExtractionLine extends Schema.Schema.Type<typeof InvoiceExtractionLine> {}

export const InvoiceExtraction = Schema.Struct({
  supplier: Schema.NullOr(Schema.String).annotate({
    description: "Supplier or vendor name, or null.",
  }),
  invoiceNumber: Schema.NullOr(Schema.String).annotate({
    description: "Invoice reference number, or null.",
  }),
  lines: Schema.Array(InvoiceExtractionLine).annotate({
    description: "Received inventory lines.",
  }),
});
export interface InvoiceExtraction extends Schema.Schema.Type<typeof InvoiceExtraction> {}

export const invoiceExtractionJsonSchema = Schema.toJsonSchemaDocument(InvoiceExtraction, {
  generateDescriptions: true,
}).schema;

const MAX_PRODUCT_SCAN_RECOGNIZED_TEXT_LENGTH = 12_000;

export const ProductScanMode = Schema.Literals(["product", "batch"]);
export type ProductScanMode = typeof ProductScanMode.Type;

export const ProductScanInput = Schema.Struct({
  recognizedText: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_PRODUCT_SCAN_RECOGNIZED_TEXT_LENGTH),
  ),
  mode: ProductScanMode,
});
export interface ProductScanInput extends Schema.Schema.Type<typeof ProductScanInput> {}

const nullableScanText = (description: string, maximumLength: number) =>
  Schema.NullOr(
    Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(maximumLength)),
  ).annotate({ description });

const normalizedScanExpiry = Schema.NullOr(
  Schema.String.check(Schema.isPattern(/^20\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/)),
).annotate({ description: "Expiry as YYYY-MM-DD, or YYYY-MM when only a month is printed." });

export const ProductScanResult = Schema.Struct({
  name: nullableScanText("Product or brand name visible in the recognized text.", 120),
  composition: nullableScanText("Active ingredient or composition, without strength.", 160),
  strength: nullableScanText("Strength including its unit, such as 500mg.", 20),
  unitsPerPack: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10_000)),
  ).annotate({ description: "Units contained in one sealed pack." }),
  batchNumber: nullableScanText("Batch or lot number.", 64),
  expiresAt: normalizedScanExpiry,
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).annotate({
    description: "Overall extraction confidence from 0 to 1.",
  }),
});
export interface ProductScanResult extends Schema.Schema.Type<typeof ProductScanResult> {}

export const productScanResultJsonSchema = Schema.toJsonSchemaDocument(ProductScanResult, {
  generateDescriptions: true,
}).schema;

export const MIN_GLOBAL_SEARCH_QUERY_LENGTH = 2;
export const MAX_GLOBAL_SEARCH_QUERY_LENGTH = 80;
export const MAX_GLOBAL_SEARCH_PRODUCTS = 8;

export const GlobalProductSearchInput = Schema.Struct({
  query: Schema.Trim.check(
    Schema.isMinLength(MIN_GLOBAL_SEARCH_QUERY_LENGTH),
    Schema.isMaxLength(MAX_GLOBAL_SEARCH_QUERY_LENGTH),
  ),
});
export interface GlobalProductSearchInput extends Schema.Schema.Type<
  typeof GlobalProductSearchInput
> {}

const HttpsUrl = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/), Schema.isMaxLength(2048));

export const GlobalProduct = Schema.Struct({
  name: Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(120)).annotate({
    description: "Product or brand name, without strength or pack size.",
  }),
  composition: nullableScanText("Active ingredient or composition, without strength.", 160),
  strength: nullableScanText("Strength including its unit, such as 500mg.", 20),
  unitsPerPack: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10_000)),
  ).annotate({ description: "Units contained in one sealed pack." }),
  manufacturer: nullableScanText("Manufacturer or brand owner.", 120),
  imageUrl: Schema.NullOr(HttpsUrl).annotate({ description: "Product image on the source site." }),
  sourceUrl: HttpsUrl.annotate({ description: "Web page the product was found on." }),
  sourceName: Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(120)).annotate({
    description: "Hostname of the source page without a leading www.",
  }),
});
export interface GlobalProduct extends Schema.Schema.Type<typeof GlobalProduct> {}

export const GlobalProductSearchResult = Schema.Struct({
  products: Schema.Array(GlobalProduct).check(Schema.isMaxLength(MAX_GLOBAL_SEARCH_PRODUCTS)),
});
export interface GlobalProductSearchResult extends Schema.Schema.Type<
  typeof GlobalProductSearchResult
> {}
