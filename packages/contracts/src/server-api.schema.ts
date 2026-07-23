import * as Schema from "effect/Schema";

// Schema for the `server:uploads` response boundary the desktop app decodes at
// IPC time. Served by `/api/uploads`, which extracts invoices with Workers AI.

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
