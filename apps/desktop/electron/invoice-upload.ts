import { invoiceUploadRejection } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { RequestError } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { InvoiceUploadFile } from "../src/host/index";
import { asServerRequestError, ServerApi, type ServerResponseInvalid } from "./server-api";

export class InvoiceUploadRejected extends Schema.TaggedError<InvoiceUploadRejected>()(
  "InvoiceUploadRejected",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason;
  }
}

export const analyseInvoiceUpload = Effect.fn("ServerApi.analyseInvoiceUpload")(function* (
  files: ReadonlyArray<InvoiceUploadFile>,
): Effect.fn.Return<
  InvoiceExtraction,
  InvoiceUploadRejected | RequestError | ServerResponseInvalid,
  ServerApi
> {
  const rejection = invoiceUploadRejection(
    files.map((file) => ({ byteLength: file.bytes.byteLength })),
  );
  if (rejection) return yield* new InvoiceUploadRejected({ reason: rejection });
  const body = new FormData();
  for (const file of files) {
    const inferredType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv";
    body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
  }
  const api = yield* ServerApi;
  return yield* api.uploads
    .extract({ payload: body })
    .pipe(asServerRequestError("Invoice analysis"));
});
