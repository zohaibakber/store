import { InvoiceExtractionService, invoiceExtractionLayer } from "@store/services";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Multipart from "effect/unstable/http/Multipart";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, StoreApi } from "../http/api";
import {
  type BadRequest,
  type PayloadTooLarge,
  badGateway,
  badRequest,
  payloadTooLarge,
  unsupportedMediaType,
} from "../http/errors";
import { ServerRuntime } from "../http/runtime";

const isInvoice = (name: string) => /\.(csv|pdf)$/i.test(name);

const multipartFailure = (
  error: Multipart.MultipartError,
): Effect.Effect<never, BadRequest | PayloadTooLarge> => {
  switch (error.reason._tag) {
    case "FileTooLarge":
    case "FieldTooLarge":
    case "BodyTooLarge":
      return Effect.fail(
        payloadTooLarge("ATTACHMENTS_TOO_LARGE", "The attachments are too large."),
      );
    case "TooManyParts":
      return Effect.fail(
        payloadTooLarge(
          "TOO_MANY_ATTACHMENTS",
          `Attach at most ${MAX_UPLOAD_FILES} invoice files.`,
        ),
      );
    case "Parse":
      return Effect.fail(badRequest("INVALID_UPLOAD", "The upload body could not be read."));
    case "InternalError":
      return Effect.die(error);
    default: {
      const _exhaustive: never = error.reason._tag;
      return _exhaustive;
    }
  }
};

const collectFiles = (parts: Stream.Stream<Multipart.Part, Multipart.MultipartError>) =>
  Stream.runFoldEffect(
    parts,
    // SAFETY: The immutable accumulator begins as an empty File collection.
    () => [] as ReadonlyArray<File>,
    (files, part) => {
      if (!Multipart.isFile(part) || part.key !== "files") return Effect.succeed(files);
      return part.contentEffect.pipe(
        Effect.map((content) => {
          const copy = new Uint8Array(content.byteLength);
          copy.set(content);
          return [...files, new File([copy.buffer], part.name, { type: part.contentType })];
        }),
      );
    },
  ).pipe(Effect.catchTag("MultipartError", multipartFailure));

export const UploadHandlers = HttpApiBuilder.group(
  StoreApi,
  "uploads",
  Effect.fn("UploadHandlers.make")(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers.handle(
      "extract",
      Effect.fn("UploadHandlers.extract")(function* ({ payload }) {
        const files = yield* collectFiles(payload);
        if (files.length === 0)
          return yield* Effect.fail(
            badRequest("NO_ATTACHMENTS", "Attach at least one invoice file."),
          );
        if (files.length > MAX_UPLOAD_FILES)
          return yield* Effect.fail(
            payloadTooLarge(
              "TOO_MANY_ATTACHMENTS",
              `Attach at most ${MAX_UPLOAD_FILES} invoice files.`,
            ),
          );
        if (files.some((file) => !isInvoice(file.name)))
          return yield* Effect.fail(
            unsupportedMediaType(
              "UNSUPPORTED_ATTACHMENT",
              "Only PDF and CSV invoices are accepted.",
            ),
          );
        if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BYTES)
          return yield* Effect.fail(
            payloadTooLarge("ATTACHMENTS_TOO_LARGE", "The attachments are too large."),
          );

        const ai = yield* runtime.invoiceAi;
        return yield* InvoiceExtractionService.pipe(
          Effect.flatMap((service) => service.extract(files)),
          Effect.provide(invoiceExtractionLayer({ ai })),
          Effect.tapError((cause) =>
            Effect.logError("Invoice extraction failed").pipe(
              Effect.annotateLogs({ cause: cause.message }),
            ),
          ),
          Effect.mapError(() =>
            badGateway("EXTRACTION_FAILED", "Invoice analysis failed. Try again."),
          ),
        );
      }),
    );
  }),
);
