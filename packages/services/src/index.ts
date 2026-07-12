import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  (value) => (value === null || value === undefined ? null : String(value).trim() || null),
  z.string().nullable(),
);
const nameField = z
  .preprocess(
    (value) => (typeof value === "string" ? value : value == null ? "" : String(value)),
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

export class InvoiceExtractionService extends Context.Service<
  InvoiceExtractionService,
  { readonly extract: (files: File[]) => Effect.Effect<InvoiceExtraction, Error> }
>()("@store/services/InvoiceExtractionService") {}

export interface InvoiceAiConfig {
  readonly model: string;
}

const parseCsv = (contents: string): InvoiceExtraction => {
  const [headerRow = "", ...rows] = contents.trim().split(/\r?\n/);
  const headers = headerRow.split(",").map((value) => value.trim().toLowerCase());
  const valueAt = (row: string[], name: string) => row[headers.indexOf(name)]?.trim() ?? "";
  return {
    supplier: null,
    invoiceNumber: null,
    lines: rows.filter(Boolean).map((row) => {
      const values = row.split(",");
      return InvoiceLine.parse({
        name:
          valueAt(values, "name") || valueAt(values, "product") || valueAt(values, "product name"),
        batchNumber: valueAt(values, "batch") || valueAt(values, "batch number") || null,
        expiresAt: valueAt(values, "expiry") || valueAt(values, "expires at") || null,
        packQuantity: Number(valueAt(values, "packs") || valueAt(values, "pack quantity") || 0),
        unitQuantity: Number(valueAt(values, "units") || valueAt(values, "unit quantity") || 0),
        unitsPerPack: Number(valueAt(values, "units per pack") || 1),
        packPrice: valueAt(values, "pack price")
          ? Math.round(Number(valueAt(values, "pack price")) * 100)
          : null,
      });
    }),
  };
};

export const invoiceExtractionLayer = (config: InvoiceAiConfig) =>
  Layer.succeed(InvoiceExtractionService, {
    extract: (files) =>
      Effect.tryPromise({
        try: async () => {
          const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
          const csvLines = (await Promise.all(csvFiles.map((file) => file.text()))).flatMap(
            (text) => parseCsv(text).lines,
          );
          const aiFiles = files.filter((file) => !file.name.toLowerCase().endsWith(".csv"));
          if (!aiFiles.length)
            return InvoiceExtraction.parse({
              supplier: null,
              invoiceNumber: null,
              lines: csvLines,
            });
          const content = await Promise.all(
            aiFiles.map(async (file) => {
              const data = await file.arrayBuffer();
              return {
                type: "file" as const,
                data,
                mediaType: "application/pdf",
                filename: file.name,
              };
            }),
          );
          const [{ gateway }, { generateText, Output, NoObjectGeneratedError }] = await Promise.all(
            [import("@ai-sdk/gateway"), import("ai")],
          );
          let result: Awaited<ReturnType<typeof generateText>>;
          try {
            result = await generateText({
              model: gateway(config.model),
              instructions:
                "Extract received inventory from the attached supplier invoices. Quantities must be whole numbers. Prices are in the invoice currency and must be returned in its smallest currency unit.",
              messages: [{ role: "user", content }],
              output: Output.object({ schema: InvoiceExtraction }),
            });
          } catch (cause) {
            if (NoObjectGeneratedError.isInstance(cause)) {
              console.error("Invoice extraction: model output failed schema validation", {
                text: cause.text,
                cause: cause.cause,
                finishReason: cause.finishReason,
              });
            }
            throw cause;
          }
          const extracted = InvoiceExtraction.parse(result.output);
          return InvoiceExtraction.parse({
            ...extracted,
            lines: [...csvLines, ...extracted.lines],
          });
        },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error("Could not read invoice attachments"),
      }),
  });
