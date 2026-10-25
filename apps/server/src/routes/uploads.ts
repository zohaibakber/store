import { MAX_INVOICE_UPLOAD_FILES } from "@store/contracts";
import type { BadRequest, PayloadTooLarge } from "@store/contracts/server-api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Multipart from "effect/http/Multipart";
import * as Stream from "effect/Stream";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import {
  badGateway,
  badRequest,
  payloadTooLarge,
  retryAfter,
  tooManyRequests,
  unsupportedMediaType,
} from "../http/errors";
import { InvoiceExtraction, type InvoiceUploadRefused } from "../invoice-extraction/service";

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
          `Attach at most ${MAX_INVOICE_UPLOAD_FILES} invoice files.`,
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
    (): ReadonlyArray<File> => [],
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

const refusal = (reason: InvoiceUploadRefused["reason"]) => {
  switch (reason) {
    case "noAttachments":
      return badRequest("NO_ATTACHMENTS", "Attach at least one invoice file.");
    case "tooMany":
      return payloadTooLarge(
        "TOO_MANY_ATTACHMENTS",
        `Attach at most ${MAX_INVOICE_UPLOAD_FILES} invoice files.`,
      );
    case "unsupported":
      return unsupportedMediaType(
        "UNSUPPORTED_ATTACHMENT",
        "Only PDF and CSV invoices are accepted.",
      );
    case "tooLarge":
      return payloadTooLarge("ATTACHMENTS_TOO_LARGE", "The attachments are too large.");
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
};

export const UploadHandlers = HttpApiBuilder.group(
  StoreApi,
  "uploads",
  Effect.fn("UploadHandlers.make")(function* (handlers) {
    const invoices = yield* InvoiceExtraction;

    return handlers.handle(
      "extract",
      Effect.fn("UploadHandlers.extract")(function* ({ payload }) {
        const identity = yield* CurrentOrganization;
        return yield* invoices.extract(identity, collectFiles(payload)).pipe(
          Effect.catchTags({
            InvoiceUploadRateLimited: (limited) =>
              retryAfter(limited.retryAfterMillis).pipe(
                Effect.andThen(
                  Effect.fail(
                    tooManyRequests(
                      "INVOICE_EXTRACTION_RATE_LIMITED",
                      "Too many invoice uploads. Try again in a minute.",
                    ),
                  ),
                ),
              ),
            InvoiceUploadRefused: (refused) => Effect.fail(refusal(refused.reason)),
            InvoiceExtractionFailed: () =>
              Effect.fail(badGateway("EXTRACTION_FAILED", "Invoice analysis failed. Try again.")),
          }),
        );
      }),
    );
  }),
);
