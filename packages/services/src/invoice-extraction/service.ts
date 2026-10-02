import { InvoiceExtraction, invoiceExtractionJsonSchema } from "@store/contracts/server-api.schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  decodeModelJson,
  ModelScalar,
  type GenerateModelJson,
  type ModelRequestError,
} from "../model-json";
import { receivedStockFromCsv } from "./csv";
import { normalizeLine, nullableString } from "./line";

class InvoiceExtractionError extends Schema.TaggedError<InvoiceExtractionError>()(
  "InvoiceExtractionError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

class AttachmentsUnreadable extends Schema.TaggedError<AttachmentsUnreadable>()(
  "AttachmentsUnreadable",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

const modelField = Schema.optional(ModelScalar);

const InvoiceModelLine = Schema.Struct({
  name: modelField,
  batchNumber: modelField,
  expiresAt: modelField,
  packQuantity: modelField,
  unitQuantity: modelField,
  unitsPerPack: modelField,
  packPrice: modelField,
});

const InvoiceModelOutput = Schema.Struct({
  supplier: modelField,
  invoiceNumber: modelField,
  lines: Schema.Array(InvoiceModelLine),
});

const decodeInvoiceModelOutput = decodeModelJson(InvoiceModelOutput);
const decodeExtraction = Schema.decodeUnknownEffect(InvoiceExtraction);

export type ConvertedDocument =
  | { readonly kind: "ok"; readonly name: string; readonly data: string }
  | { readonly kind: "error"; readonly name: string; readonly error: string };

export interface InvoiceAiClient {
  readonly toMarkdown: (
    documents: ReadonlyArray<{ readonly name: string; readonly blob: Blob }>,
  ) => Effect.Effect<ReadonlyArray<ConvertedDocument>, ModelRequestError>;
  readonly generate: GenerateModelJson<typeof InvoiceModelOutput.Encoded>;
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

const normalizeExtraction = (value: typeof InvoiceModelOutput.Type) => ({
  supplier: nullableString(value.supplier),
  invoiceNumber: nullableString(value.invoiceNumber),
  lines: value.lines.map(normalizeLine),
});

const isFailure = (
  document: ConvertedDocument,
): document is { readonly kind: "error"; readonly name: string; readonly error: string } =>
  document.kind === "error";

const isSuccess = (
  document: ConvertedDocument,
): document is { readonly kind: "ok"; readonly name: string; readonly data: string } =>
  document.kind === "ok";

const unreadableMessage = (failures: ReadonlyArray<{ readonly name: string }>) => {
  const [failure] = failures;
  return failure && failures.length === 1
    ? `${failure.name} could not be read.`
    : "None of the attachments could be read.";
};

const readableMarkdown = (converted: ReadonlyArray<ConvertedDocument>) =>
  converted
    .filter(isSuccess)
    .filter((document) => document.data.trim())
    .map((document) => `## ${document.name}\n\n${document.data.trim()}`);

const isCsv = (file: File) => file.name.toLowerCase().endsWith(".csv");

const readCsvFiles = (files: ReadonlyArray<File>) =>
  Effect.tryPromise({
    try: () => Promise.all(files.map((file) => file.text())),
    catch: (cause) =>
      new AttachmentsUnreadable({ message: "A CSV attachment could not be read.", cause }),
  });

export const extractInvoice = Effect.fn("InvoiceExtraction.extract")(
  function* (ai: InvoiceAiClient, files: ReadonlyArray<File>) {
    const csvContents = yield* readCsvFiles(files.filter(isCsv));
    const csvLines = csvContents.flatMap(receivedStockFromCsv);
    const aiFiles = files.filter((file) => !isCsv(file));
    if (csvLines.length > 0 || !aiFiles.length)
      return yield* decodeExtraction({ supplier: null, invoiceNumber: null, lines: csvLines });

    const converted = yield* ai
      .toMarkdown(aiFiles.map((file) => ({ name: file.name, blob: file })))
      .pipe(Effect.timeout("15 seconds"));
    const failures = converted.filter(isFailure);
    for (const failure of failures) {
      yield* Effect.logWarning("Invoice attachment conversion failed").pipe(
        Effect.annotateLogs({ name: failure.name, error: failure.error }),
      );
    }
    if (failures.length === converted.length)
      return yield* new AttachmentsUnreadable({ message: unreadableMessage(failures) });
    const documents = readableMarkdown(converted);
    if (!documents.length)
      return yield* new AttachmentsUnreadable({
        message: "No readable text could be extracted from the attachments.",
      });

    const raw = yield* ai
      .generate({
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: documents.join("\n\n") },
        ],
        jsonSchema: invoiceExtractionJsonSchema,
      })
      .pipe(Effect.timeout("30 seconds"));
    const output = yield* decodeInvoiceModelOutput(raw);
    return yield* decodeExtraction(normalizeExtraction(output));
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
);
