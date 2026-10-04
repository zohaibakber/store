import { invoiceUploadRejection } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { RequestError, SessionHttp } from "@store/workspace";
import * as Effect from "effect/Effect";

import { asServerRequestError, serverApi } from "./server-api";

export type InvoiceUploadFile = {
  readonly name: string;
  readonly type: string;
  readonly bytes: ArrayBuffer;
};

export const analyseInvoiceUpload = Effect.fn("analyseInvoiceUpload")(function* (
  files: ReadonlyArray<InvoiceUploadFile>,
): Effect.fn.Return<InvoiceExtraction, Error | RequestError, SessionHttp> {
  const rejection = invoiceUploadRejection(
    files.map((file) => ({ byteLength: file.bytes.byteLength })),
  );
  if (rejection) return yield* Effect.fail(new Error(rejection));
  const body = new FormData();
  for (const file of files) {
    const inferredType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv";
    body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
  }
  const api = yield* serverApi;
  return yield* api.uploads
    .extract({ payload: body })
    .pipe(asServerRequestError("Invoice analysis returned an unexpected response."));
});
