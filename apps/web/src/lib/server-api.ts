import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { RequestError } from "@/auth";
import { authSession } from "@/lib/auth";

export const analyseInvoices = async (
  files: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly bytes: ArrayBuffer;
  }>,
) => {
  if (window.serverApi) return window.serverApi.analyseInvoices({ files: [...files] });

  const body = new FormData();
  for (const file of files) {
    const inferredType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv";
    body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
  }

  let raw: unknown;
  try {
    const apiRequest = authSession().apiRequest;
    if (!apiRequest) throw new Error("Invoice analysis is unavailable in this build.");
    raw = await apiRequest("/api/uploads", { method: "POST", body });
  } catch (cause) {
    if (cause instanceof RequestError) throw new Error(cause.message);
    throw cause instanceof Error ? cause : new Error("Invoice analysis failed.");
  }

  return Effect.runPromise(
    Schema.decodeUnknownEffect(InvoiceExtraction)(raw).pipe(
      Effect.mapError(() => new Error("Unexpected response from invoice analysis.")),
    ),
  );
};
