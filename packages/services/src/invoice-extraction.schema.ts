import { z } from "zod";

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const countField = (fallback: number, min: number) =>
  z
    .preprocess((value) => toFiniteNumber(value) ?? fallback, z.number())
    .transform((value) => Math.max(min, Math.round(value)));

const priceField = z
  .preprocess((value) => (value == null ? null : toFiniteNumber(value)), z.number().nullable())
  .transform((value) => (value == null ? null : Math.max(0, Math.round(value))));

const nullableStringField = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.trim() || null
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : null,
  z.string().nullable(),
);

const nameField = z
  .preprocess(
    (value) =>
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
          ? String(value)
          : "",
    z.string(),
  )
  .transform((value) => value.trim() || "Unspecified item");

export const InvoiceLine = z.object({
  name: nameField.describe("Product name exactly as printed on the invoice line."),
  batchNumber: nullableStringField.describe("Batch or lot number, or null when absent."),
  expiresAt: nullableStringField.describe("Expiry date as (DD-MM-YYYY), or null."),
  packQuantity: countField(0, 0).describe("Whole number of packs received."),
  unitQuantity: countField(0, 0).describe("Whole number of loose units received, beyond packs."),
  unitsPerPack: countField(1, 1).describe("Whole number of units contained in one pack."),
  packPrice: priceField.describe(
    "Price of one pack in the invoice currency's smallest unit (e.g. cents), or null.",
  ),
});

export const InvoiceExtraction = z.object({
  supplier: nullableStringField.describe("Supplier or vendor name, or null."),
  invoiceNumber: nullableStringField.describe("Invoice reference number, or null."),
  lines: z.array(InvoiceLine).describe("One entry per received inventory line on the invoice."),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

/**
 * JSON Schema handed to the model to constrain its output. Derived from the
 * input side of `InvoiceExtraction` so the two cannot drift: the zod schema
 * stays responsible for coercing whatever the model actually returns, while
 * this steers it towards returning the right shape in the first place.
 */
export const invoiceExtractionJsonSchema = z.toJSONSchema(InvoiceExtraction, { io: "input" });
