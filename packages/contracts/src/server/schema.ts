import * as Schema from "effect/Schema";

const nonNegativeInteger = (description: string) =>
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ description });

const positiveInteger = (description: string) =>
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description });

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
