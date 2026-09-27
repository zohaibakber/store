import { invoiceUploadRejection } from "@store/contracts";
import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { JsonApiResponse, JsonRequestInit } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type InvoiceUploadFile = {
  readonly name: string;
  readonly type: string;
  readonly bytes: ArrayBuffer;
};

type ApiRequest = (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;

export const analyseInvoiceUpload = async (
  apiRequest: ApiRequest,
  files: ReadonlyArray<InvoiceUploadFile>,
): Promise<InvoiceExtraction> => {
  const rejection = invoiceUploadRejection(
    files.map((file) => ({ byteLength: file.bytes.byteLength })),
  );
  if (rejection) throw new Error(rejection);
  const body = new FormData();
  for (const file of files) {
    const inferredType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv";
    body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
  }
  const raw = await apiRequest("/api/uploads", { method: "POST", body });
  return await Effect.runPromise(
    Schema.decodeUnknownEffect(InvoiceExtraction)(raw).pipe(
      Effect.mapError(() => new Error("Invoice analysis returned an unexpected response.")),
    ),
  );
};
