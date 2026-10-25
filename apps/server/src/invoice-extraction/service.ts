import { MAX_INVOICE_UPLOAD_BYTES, MAX_INVOICE_UPLOAD_FILES } from "@store/contracts";
import type { InvoiceExtraction as InvoiceExtractionResult } from "@store/contracts/server-api.schema";
import { extractInvoice } from "@store/services";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { invoiceAiClient } from "../ai/workers-ai";
import type { Actor } from "../authority/engine";

const RATE_LIMIT = { limit: 10, period: 60 } as const;

const isInvoice = (name: string) => /\.(csv|pdf)$/i.test(name);

export class InvoiceUploadRateLimited extends Schema.TaggedError<InvoiceUploadRateLimited>()(
  "InvoiceUploadRateLimited",
  { retryAfterMillis: Schema.Number },
) {}

export class InvoiceUploadRefused extends Schema.TaggedError<InvoiceUploadRefused>()(
  "InvoiceUploadRefused",
  { reason: Schema.Literals(["noAttachments", "tooMany", "unsupported", "tooLarge"]) },
) {}

export class InvoiceExtractionFailed extends Schema.TaggedError<InvoiceExtractionFailed>()(
  "InvoiceExtractionFailed",
  { message: Schema.String },
) {}

export class InvoiceExtraction extends Context.Service<
  InvoiceExtraction,
  {
    readonly extract: <E, R>(
      actor: Actor,
      files: Effect.Effect<ReadonlyArray<File>, E, R>,
    ) => Effect.Effect<
      InvoiceExtractionResult,
      E | InvoiceUploadRateLimited | InvoiceUploadRefused | InvoiceExtractionFailed,
      R | RuntimeContext
    >;
  }
>()("@store/server/InvoiceExtraction") {
  static readonly layer = Layer.effect(
    InvoiceExtraction,
    Effect.gen(function* () {
      const ai = yield* Cloudflare.Workers.AI();
      const rateLimit = yield* Cloudflare.RateLimit("INVOICE_EXTRACTION_RATE_LIMIT", {
        namespaceId: 1002,
        simple: RATE_LIMIT,
      });

      const extract = Effect.fn("InvoiceExtraction.extract")(function* <E, R>(
        actor: Actor,
        collect: Effect.Effect<ReadonlyArray<File>, E, R>,
      ) {
        const admitted = yield* rateLimit
          .limit({ key: `${actor.organizationId}:${actor.userId}` })
          .pipe(Effect.orDie);
        if (!admitted.success) {
          return yield* new InvoiceUploadRateLimited({
            retryAfterMillis: RATE_LIMIT.period * 1_000,
          });
        }

        const files = yield* collect;
        if (files.length === 0) return yield* new InvoiceUploadRefused({ reason: "noAttachments" });
        if (files.length > MAX_INVOICE_UPLOAD_FILES) {
          return yield* new InvoiceUploadRefused({ reason: "tooMany" });
        }
        if (files.some((file) => !isInvoice(file.name))) {
          return yield* new InvoiceUploadRefused({ reason: "unsupported" });
        }
        if (files.reduce((total, file) => total + file.size, 0) > MAX_INVOICE_UPLOAD_BYTES) {
          return yield* new InvoiceUploadRefused({ reason: "tooLarge" });
        }

        const client = invoiceAiClient(yield* ai.raw);
        return yield* extractInvoice(client, files).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Invoice extraction failed").pipe(
              Effect.annotateLogs({ cause: cause.message }),
            ),
          ),
          Effect.mapError((cause) => new InvoiceExtractionFailed({ message: cause.message })),
        );
      });

      return InvoiceExtraction.of({ extract });
    }),
  );
}
