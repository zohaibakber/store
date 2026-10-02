import { invoiceUploadRejection } from "@store/contracts";
import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import {
  SessionHttp,
  asRequestError,
  decodeResponse,
  isInvalidResponse,
  type RequestError,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";

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
  const session = yield* SessionHttp;
  const response = yield* asRequestError(
    session.http.post(`${session.apiBaseUrl}/api/uploads`, { body: HttpBody.formData(body) }),
  );
  return yield* decodeResponse(InvoiceExtraction)(response).pipe(
    Effect.catchIf(isInvalidResponse, () =>
      Effect.fail(new Error("Invoice analysis returned an unexpected response.")),
    ),
  );
});
