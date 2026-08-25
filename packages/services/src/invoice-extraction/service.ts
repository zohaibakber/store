import {
  InvoiceExtraction,
  type InvoiceExtractionLine,
  invoiceExtractionJsonSchema,
} from "@store/contracts/server-api.schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { parseCsvRecords } from "./csv";
import { parseMajorCurrencyToMinor, parseUnitsPerPack, salvageUnitsPerPack } from "./pack-size";

export class InvoiceExtractionError extends Schema.TaggedError<InvoiceExtractionError>()(
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

type ModelScalar = string | number | boolean | null;

interface InvoiceLineModel {
  readonly name?: ModelScalar;
  readonly batchNumber?: ModelScalar;
  readonly expiresAt?: ModelScalar;
  readonly packQuantity?: ModelScalar;
  readonly unitQuantity?: ModelScalar;
  readonly unitsPerPack?: ModelScalar;
  readonly packPrice?: ModelScalar;
}

export interface InvoiceModelObject {
  readonly response?: string;
  readonly supplier?: ModelScalar;
  readonly invoiceNumber?: ModelScalar;
  readonly lines?: ReadonlyArray<InvoiceLineModel> | ModelScalar;
}

export type InvoiceModelOutput = string | InvoiceModelObject;

export type ConvertedDocument =
  | { readonly kind: "ok"; readonly name: string; readonly data: string }
  | { readonly kind: "error"; readonly name: string; readonly error: string };

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
    readonly signal: AbortSignal;
  }) => Promise<InvoiceModelOutput>;
}

export interface InvoiceAiConfig {
  readonly ai: InvoiceAiClient;
}

const instructions = [
  "Extract received inventory from the supplier invoices below.",
  "Rules:",
  "- Every quantity is a whole number.",
  '- unitsPerPack is how many units one sealed pack contains. Multiply pack factors: "10x10" is 100, not 1010. "20\'s" and "20s" are 20. "1" is 1.',
  "- packQuantity is how many whole sealed packs were received.",
  "- unitQuantity is only the LOOSE units received on top of the whole packs, usually from a",
  "  'loose' or 'extra' column. It is 0 when there are none. It is never a copy of unitsPerPack.",
  "- packPrice is the price of ONE pack as an integer in the invoice currency's smallest unit (no thousand separators).",
  "- Ignore subtotal, tax, delivery, and grand total rows; they are not received stock.",
  "- Dates as DD-MM-YYYY, or null when absent.",
  "Respond with JSON matching the provided schema and nothing else.",
].join("\n");

const isString = <Value>(value: Value): value is Value & string => typeof value === "string";
const isNumber = <Value>(value: Value): value is Value & number => typeof value === "number";

const toFiniteNumber = (value: ModelScalar | undefined): number | null => {
  if (isNumber(value)) return Number.isFinite(value) ? value : null;
  if (!isString(value)) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const nullableString = (value: ModelScalar | undefined): string | null => {
  if (isString(value)) return value.trim() || null;
  if (value !== undefined && value !== null) return String(value);
  return null;
};

const count = (value: ModelScalar | undefined, fallback: number, minimum: number): number =>
  Math.max(minimum, Math.round(toFiniteNumber(value) ?? fallback));

const unspecifiedItemName = "Unspecified item";

/** CSV rows that only exist because headers did not map still parse as a line. */
export const hasReceivedStock = (line: InvoiceExtractionLine): boolean => {
  const name = line.name.trim();
  return (
    name.length > 0 && name !== unspecifiedItemName && line.packQuantity + line.unitQuantity > 0
  );
};

const normalizeLine = (value: InvoiceLineModel): InvoiceExtractionLine => {
  const name = nullableString(value.name) ?? unspecifiedItemName;
  return {
    name,
    batchNumber: nullableString(value.batchNumber),
    expiresAt: nullableString(value.expiresAt),
    packQuantity: count(value.packQuantity, 0, 0),
    unitQuantity: count(value.unitQuantity, 0, 0),
    unitsPerPack: salvageUnitsPerPack(
      name,
      isString(value.unitsPerPack) || isNumber(value.unitsPerPack)
        ? parseUnitsPerPack(value.unitsPerPack, 1)
        : 1,
    ),
    packPrice:
      value.packPrice == null
        ? null
        : Math.max(0, Math.round(toFiniteNumber(value.packPrice) ?? 0)),
  };
};

const normalizeExtraction = (value: InvoiceModelObject) => {
  const lines = value.lines;
  return {
    supplier: nullableString(value.supplier),
    invoiceNumber: nullableString(value.invoiceNumber),
    lines: Array.isArray(lines) ? lines.map(normalizeLine) : lines,
  };
};

export const parseCsv = (contents: string): ReadonlyArray<InvoiceExtractionLine> => {
  const [headerRow = [], ...rows] = parseCsvRecords(contents);
  const headers = headerRow.map((value) => value.trim().toLowerCase());
  const valueAt = (row: ReadonlyArray<string>, name: string) =>
    row[headers.indexOf(name)]?.trim() ?? "";
  return rows.map((values) =>
    normalizeLine({
      name:
        valueAt(values, "name") || valueAt(values, "product") || valueAt(values, "product name"),
      batchNumber: valueAt(values, "batch") || valueAt(values, "batch number") || null,
      expiresAt: valueAt(values, "expiry") || valueAt(values, "expires at") || null,
      packQuantity: valueAt(values, "packs") || valueAt(values, "pack quantity") || 0,
      unitQuantity: valueAt(values, "units") || valueAt(values, "unit quantity") || 0,
      unitsPerPack: valueAt(values, "units per pack") || 1,
      packPrice: parseMajorCurrencyToMinor(valueAt(values, "pack price")),
    }),
  );
};

const isFailure = (
  document: ConvertedDocument,
): document is { readonly kind: "error"; readonly name: string; readonly error: string } =>
  document.kind === "error";

const isSuccess = (
  document: ConvertedDocument,
): document is { readonly kind: "ok"; readonly name: string; readonly data: string } =>
  document.kind === "ok";

const documentsToMarkdown = (converted: ReadonlyArray<ConvertedDocument>) => {
  const failures = converted.filter(isFailure);
  if (failures.length === converted.length) {
    const [failure] = failures;
    throw new Error(
      failure && failures.length === 1
        ? `${failure.name} could not be read.`
        : "None of the attachments could be read.",
    );
  }
  return converted
    .filter(isSuccess)
    .filter((document) => document.data.trim())
    .map((document) => `## ${document.name}\n\n${document.data.trim()}`);
};

const parseModelOutput = (raw: InvoiceModelOutput): InvoiceModelObject => {
  const response = isString(raw) ? raw : (raw.response ?? raw);
  if (!isString(response)) return response;
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? response).trim();
  try {
    const parsed: InvoiceModelObject = JSON.parse(candidate);
    return parsed;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
    const parsed: InvoiceModelObject = JSON.parse(candidate.slice(start, end + 1));
    return parsed;
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
        const csvLines = csvContents.flatMap(parseCsv).filter(hasReceivedStock);
        const aiFiles = files.filter((file) => !file.name.toLowerCase().endsWith(".csv"));
        // CSV already has received-stock lines. Mixing in a PDF of the same
        // shipment would double-count packs, so the spreadsheet wins. A CSV
        // whose columns did not map (placeholder names, zero quantities) is
        // not a spreadsheet of received stock, so PDFs still get extracted.
        if (csvLines.length > 0 || !aiFiles.length)
          return yield* Schema.decodeUnknownEffect(InvoiceExtraction)({
            supplier: null,
            invoiceNumber: null,
            lines: csvLines,
          });

        const converted = yield* Effect.tryPromise(() =>
          config.ai.toMarkdown(aiFiles.map((file) => ({ name: file.name, blob: file }))),
        ).pipe(Effect.timeout("15 seconds"));
        for (const failure of converted.filter(isFailure)) {
          yield* Effect.logWarning("Invoice attachment conversion failed").pipe(
            Effect.annotateLogs({ name: failure.name, error: failure.error }),
          );
        }
        const documents = yield* Effect.try(() => documentsToMarkdown(converted));
        if (!documents.length)
          return yield* Effect.fail(
            new Error("No readable text could be extracted from the attachments."),
          );

        const raw = yield* Effect.tryPromise((signal) =>
          config.ai.generate({
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: documents.join("\n\n") },
            ],
            jsonSchema: invoiceExtractionJsonSchema,
            signal,
          }),
        ).pipe(Effect.timeout("30 seconds"));
        const output = yield* Effect.try(() => parseModelOutput(raw));
        return yield* Schema.decodeUnknownEffect(InvoiceExtraction)(normalizeExtraction(output));
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
