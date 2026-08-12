import {
  InvoiceExtraction,
  type InvoiceExtractionLine,
  invoiceExtractionJsonSchema,
} from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class InvoiceExtractionError extends Schema.TaggedErrorClass<InvoiceExtractionError>()(
  "InvoiceExtractionError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

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

export interface InvoiceAiClient {
  readonly toMarkdown: (
    documents: ReadonlyArray<{ readonly name: string; readonly blob: Blob }>,
  ) => Promise<ReadonlyArray<ConvertedDocument>>;
  readonly generate: (input: {
    readonly messages: ReadonlyArray<{
      readonly role: "system" | "user";
      readonly content: string;
    }>;
    readonly jsonSchema: object;
  }) => Promise<unknown>;
}

export interface InvoiceAiConfig {
  readonly ai: InvoiceAiClient;
}

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

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;

const nullableString = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return null;
};

const count = (value: unknown, fallback: number, minimum: number): number =>
  Math.max(minimum, Math.round(toFiniteNumber(value) ?? fallback));

const normalizeLine = (value: unknown): InvoiceExtractionLine => ({
  name: nullableString(field(value, "name")) ?? "Unspecified item",
  batchNumber: nullableString(field(value, "batchNumber")),
  expiresAt: nullableString(field(value, "expiresAt")),
  packQuantity: count(field(value, "packQuantity"), 0, 0),
  unitQuantity: count(field(value, "unitQuantity"), 0, 0),
  unitsPerPack: count(field(value, "unitsPerPack"), 1, 1),
  packPrice:
    field(value, "packPrice") == null
      ? null
      : Math.max(0, Math.round(toFiniteNumber(field(value, "packPrice")) ?? 0)),
});

const normalizeExtraction = (value: unknown): unknown => {
  const lines = field(value, "lines");
  return {
    supplier: nullableString(field(value, "supplier")),
    invoiceNumber: nullableString(field(value, "invoiceNumber")),
    lines: Array.isArray(lines) ? lines.map(normalizeLine) : lines,
  };
};

const parseCsv = (contents: string): ReadonlyArray<InvoiceExtractionLine> => {
  const [headerRow = "", ...rows] = contents.trim().split(/\r?\n/);
  const headers = headerRow.split(",").map((value) => value.trim().toLowerCase());
  const valueAt = (row: string[], name: string) => row[headers.indexOf(name)]?.trim() ?? "";
  return rows.filter(Boolean).map((row) => {
    const values = row.split(",");
    return normalizeLine({
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
  });
};

const isFailure = (
  document: ConvertedDocument,
): document is { readonly name: string; readonly error: string } => "error" in document;

const isSuccess = (
  document: ConvertedDocument,
): document is { readonly name: string; readonly data: string } => "data" in document;

const documentsToMarkdown = async (ai: InvoiceAiClient, files: ReadonlyArray<File>) => {
  const converted = await ai.toMarkdown(files.map((file) => ({ name: file.name, blob: file })));
  const failures = converted.filter(isFailure);
  for (const failure of failures)
    console.error("Invoice extraction: attachment could not be converted", {
      name: failure.name,
      error: failure.error,
    });
  if (failures.length === converted.length)
    throw new Error(
      failures.length === 1
        ? `${failures[0]?.name} could not be read.`
        : "None of the attachments could be read.",
    );
  return converted
    .filter(isSuccess)
    .filter((document) => document.data.trim())
    .map((document) => `## ${document.name}\n\n${document.data.trim()}`);
};

const parseModelOutput = (raw: unknown): unknown => {
  const response = field(raw, "response") ?? raw;
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
    extract: Effect.fn("InvoiceExtraction.extract")(
      function* (files: ReadonlyArray<File>) {
        const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
        const csvContents = yield* Effect.tryPromise(() =>
          Promise.all(csvFiles.map((file) => file.text())),
        );
        const csvLines = csvContents.flatMap(parseCsv);
        const aiFiles = files.filter((file) => !file.name.toLowerCase().endsWith(".csv"));
        if (!aiFiles.length)
          return yield* Schema.decodeUnknownEffect(InvoiceExtraction)({
            supplier: null,
            invoiceNumber: null,
            lines: csvLines,
          });

        const documents = yield* Effect.tryPromise(() => documentsToMarkdown(config.ai, aiFiles));
        if (!documents.length)
          return yield* Effect.fail(
            new Error("No readable text could be extracted from the attachments."),
          );

        const raw = yield* Effect.tryPromise(() =>
          config.ai.generate({
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: documents.join("\n\n") },
            ],
            jsonSchema: invoiceExtractionJsonSchema,
          }),
        );
        const output = yield* Effect.try(() => parseModelOutput(raw));
        const extracted = yield* Schema.decodeUnknownEffect(InvoiceExtraction)(
          normalizeExtraction(output),
        );
        return InvoiceExtraction.make({
          ...extracted,
          lines: [...csvLines, ...extracted.lines],
        });
      },
      (effect) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new InvoiceExtractionError({
                message: "Could not extract invoice attachments.",
                cause,
              }),
          ),
        ),
    ),
  });
