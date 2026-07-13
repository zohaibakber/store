import { InvoiceExtractionService, invoiceExtractionLayer } from "@store/services";
import * as Effect from "effect/Effect";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../auth-client";
import { publicError } from "../errors";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const acceptedTypes = new Set(["application/pdf", "text/csv", "application/vnd.ms-excel"]);

const acceptedFile = (file: File) => {
  const extension = file.name.toLowerCase().split(".").pop();
  return (extension === "csv" || extension === "pdf") && acceptedTypes.has(file.type);
};

const defaultModel = "openai/gpt-4.1-mini";
const isGatewayModel = (value: string) => /^[a-z0-9][a-z0-9._/-]{1,160}$/i.test(value);

export const uploadsRoute = new Hono<AppEnv>().post(
  "/",
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) =>
      c.json(publicError("UPLOAD_TOO_LARGE", "The upload exceeds the 25 MB request limit."), 413),
  }),
  async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = (Array.isArray(body.files) ? body.files : [body.files]).filter(
      (value): value is File => value instanceof File,
    );
    if (!files.length)
      return c.json(publicError("FILES_REQUIRED", "Attach at least one CSV or PDF invoice."), 400);
    if (files.length > MAX_FILES)
      return c.json(publicError("TOO_MANY_FILES", `Attach no more than ${MAX_FILES} files.`), 400);
    if (files.some((file) => file.size > MAX_FILE_BYTES))
      return c.json(publicError("FILE_TOO_LARGE", "Each file must be 10 MB or smaller."), 413);
    if (files.some((file) => !acceptedFile(file)))
      return c.json(
        publicError("UNSUPPORTED_FILE", "Only CSV and PDF invoices are supported."),
        415,
      );
    const model =
      typeof body.model === "string" && isGatewayModel(body.model) ? body.model : defaultModel;
    try {
      const extraction = await Effect.runPromise(
        Effect.flatMap(InvoiceExtractionService, (service) => service.extract(files)).pipe(
          Effect.provide(invoiceExtractionLayer({ model })),
        ),
      );
      return c.json(extraction);
    } catch {
      return c.json(publicError("INVOICE_EXTRACTION_FAILED", "Invoice parsing failed."), 422);
    }
  },
);
