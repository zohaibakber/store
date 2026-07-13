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
  name: nameField,
  batchNumber: nullableStringField,
  expiresAt: nullableStringField,
  packQuantity: countField(0, 0),
  unitQuantity: countField(0, 0),
  unitsPerPack: countField(1, 1),
  packPrice: priceField,
});

export const InvoiceExtraction = z.object({
  supplier: nullableStringField,
  invoiceNumber: nullableStringField,
  lines: z.array(InvoiceLine),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;
