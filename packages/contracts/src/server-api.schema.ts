import * as Schema from "effect/Schema";

// Schemas for the two server/AI-gateway response boundaries the desktop app
// decodes at IPC time (`server:models`, `server:uploads`). The server side of
// these endpoints does not exist yet — these schemas double as the contract
// the future implementation must satisfy.

export const GatewayModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
});
export type GatewayModel = typeof GatewayModel.Type;

export const ModelCatalogResponse = Schema.Struct({
  data: Schema.optional(Schema.Array(GatewayModel)),
});
export type ModelCatalogResponse = typeof ModelCatalogResponse.Type;

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
