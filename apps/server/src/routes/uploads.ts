import { InvoiceExtractionService, invoiceExtractionLayer } from "@store/services";
import * as Effect from "effect/Effect";
import { Hono } from "hono";

import { invoiceAiClient } from "../ai/invoice-ai";
import type { AppEnv } from "../http/context";
import { publicError } from "../http/errors";

/** Mirrors what the desktop uploader accepts before it sends anything. */
const isInvoice = (name: string) => /\.(csv|pdf)$/i.test(name);

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const uploadsRoute = new Hono<AppEnv>().post("/", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(publicError("INVALID_UPLOAD", "The upload body could not be read."), 400);
  }

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (!files.length)
    return c.json(publicError("NO_ATTACHMENTS", "Attach at least one invoice file."), 400);
  if (files.length > MAX_FILES)
    return c.json(
      publicError("TOO_MANY_ATTACHMENTS", `Attach at most ${MAX_FILES} invoice files.`),
      413,
    );
  if (files.some((file) => !isInvoice(file.name)))
    return c.json(
      publicError("UNSUPPORTED_ATTACHMENT", "Only PDF and CSV invoices can be analysed."),
      415,
    );
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES)
    return c.json(publicError("ATTACHMENTS_TOO_LARGE", "The attachments are too large."), 413);

  try {
    const extraction = await Effect.runPromise(
      InvoiceExtractionService.pipe(
        Effect.flatMap((service) => service.extract(files)),
        Effect.provide(invoiceExtractionLayer({ ai: invoiceAiClient(c.env.AI) })),
      ),
    );
    return c.json(extraction);
  } catch (cause) {
    console.error("Invoice extraction failed", cause instanceof Error ? cause.message : cause);
    return c.json(
      publicError("EXTRACTION_FAILED", "The invoices could not be analysed. Try again."),
      502,
    );
  }
});
