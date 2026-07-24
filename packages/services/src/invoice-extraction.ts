import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  InvoiceExtraction,
  InvoiceLine,
  invoiceExtractionJsonSchema,
} from "./invoice-extraction.schema";

export class InvoiceExtractionError extends Data.TaggedError("InvoiceExtractionError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class InvoiceExtractionService extends Context.Service<
  InvoiceExtractionService,
  {
    readonly extract: (
      files: ReadonlyArray<File>,
    ) => Effect.Effect<InvoiceExtraction, InvoiceExtractionError>;
  }
>()("@store/services/InvoiceExtractionService") {}

export type ConvertedDocument =
  | { readonly name: string; readonly data: string }
  | { readonly name: string; readonly error: string };

/**
 * The slice of the Workers AI binding this service needs. Kept structural (as
 * with `AuthApi` on the server) so the package stays free of Workers types and
 * the runtime can be substituted in tests.
 */
export interface InvoiceAiClient {
  /**
   * Converts documents the model cannot read directly (PDFs) into markdown.
   * Conversion is per-document, so individual entries can fail without the
   * whole batch failing.
   */
  readonly toMarkdown: (
    documents: ReadonlyArray<{ readonly name: string; readonly blob: Blob }>,
  ) => Promise<ReadonlyArray<ConvertedDocument>>;
  /** Runs the configured text model with a JSON-schema-constrained response. */
  readonly generate: (input: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
    readonly jsonSchema: object;
  }) => Promise<unknown>;
}

export interface InvoiceAiConfig {
  readonly ai: InvoiceAiClient;
}

// Wording matters more than it looks. An earlier, terser version of these rules
// made the model copy `unitsPerPack` into `unitQuantity`, which silently
// inflated received stock by a whole pack's worth per line; spelling out that
// loose units are only the remainder fixed it.
const instructions = [
  "Extract received inventory from the supplier invoices below.",
  "Rules:",
  "- Every quantity is a whole number.",
  '- unitsPerPack is how many units one sealed pack contains: "10x10" is 100, "20\'s" is 20, "1" is 1.',
  "- packQuantity is how many whole sealed packs were received.",
  "- unitQuantity is only the LOOSE units received on top of the whole packs, usually from a",
  "  'loose' or 'extra' column. It is 0 when there are none. It is never a copy of unitsPerPack.",
  "- packPrice is the price of ONE pack in the invoice currency's smallest unit (e.g. rupees x 100).",
  "- Ignore subtotal, tax, delivery, and grand total rows; they are not received stock.",
  "- Dates as DD-MM-YYYY, or null when absent.",
  "Respond with JSON matching the provided schema and nothing else.",
].join("\n");

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

/**
 * Workers AI text models accept text and images, never PDFs, so documents are
 * converted to markdown first. Markdown also preserves invoice table structure
 * better than page images would.
 */
const documentsToMarkdown = async (ai: InvoiceAiClient, files: ReadonlyArray<File>) => {
  const converted = await ai.toMarkdown(
    files.map((file) => ({ name: file.name, blob: file as unknown as Blob })),
  );
  const failures = converted.filter((document) => "error" in document);
  for (const failure of failures)
    console.error("Invoice extraction: attachment could not be converted", {
      name: failure.name,
      error: (failure as { error: string }).error,
    });
  // One unreadable attachment out of several should not discard the rest; only
  // a batch where nothing converted is a hard failure.
  if (failures.length === converted.length)
    throw new Error(
      failures.length === 1
        ? `${failures[0]?.name} could not be read.`
        : "None of the attachments could be read.",
    );
  return converted
    .filter((document): document is { name: string; data: string } => "data" in document)
    .filter((document) => document.data.trim())
    .map((document) => `## ${document.name}\n\n${document.data.trim()}`);
};

/** Workers AI returns the completion under `response`, as a string or pre-parsed JSON. */
const parseModelOutput = (raw: unknown): unknown => {
  const response = (raw as { response?: unknown } | null)?.response ?? raw;
  if (typeof response !== "string") return response;
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? response).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
    return JSON.parse(candidate.slice(start, end + 1));
  }
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

          const documents = await documentsToMarkdown(config.ai, aiFiles);
          if (!documents.length)
            throw new Error("No readable text could be extracted from the attachments.");

          const raw = await config.ai.generate({
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: documents.join("\n\n") },
            ],
            jsonSchema: invoiceExtractionJsonSchema,
          });

          let output: unknown;
          try {
            output = parseModelOutput(raw);
          } catch (cause) {
            console.error("Invoice extraction: model output was not valid JSON", { raw });
            throw cause;
          }

          const parsed = InvoiceExtraction.safeParse(output);
          if (!parsed.success) {
            console.error("Invoice extraction: model output failed schema validation", {
              output,
              issues: parsed.error.issues,
            });
            throw new Error("The model output did not match the expected invoice shape.");
          }

          return InvoiceExtraction.parse({
            ...parsed.data,
            lines: [...csvLines, ...parsed.data.lines],
          });
        },
        catch: (cause) =>
          new InvoiceExtractionError({
            message: "Could not extract invoice attachments.",
            cause,
          }),
      }),
  });
