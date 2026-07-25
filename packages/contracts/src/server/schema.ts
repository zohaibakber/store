import * as Schema from "effect/Schema";

export const InvoiceExtractionLine = Schema.Struct({
  name: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
  unitsPerPack: Schema.Number,
  packPrice: Schema.NullOr(Schema.Number),
});
export type InvoiceExtractionLine = typeof InvoiceExtractionLine.Type;

export const InvoiceExtraction = Schema.Struct({
  supplier: Schema.NullOr(Schema.String),
  invoiceNumber: Schema.NullOr(Schema.String),
  lines: Schema.Array(InvoiceExtractionLine),
});
export type InvoiceExtraction = typeof InvoiceExtraction.Type;
