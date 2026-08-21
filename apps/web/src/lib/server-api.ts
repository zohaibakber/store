import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";

const ApiFailure = Schema.Struct({ message: Schema.String });

const apiUrl = (pathname: string) => {
  const base = resolveBrowserApiBaseUrl({
    configuredApiUrl: import.meta.env.VITE_API_URL ?? "",
    pageOrigin: globalThis.location.origin,
  });
  return `${base}${pathname}`;
};

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
  const response = await fetch(apiUrl("/api/uploads"), {
    method: "POST",
    body,
    credentials: "include",
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = Schema.decodeUnknownOption(ApiFailure)(raw).pipe(Option.getOrNull);
    const message = failure?.message ?? `Invoice analysis failed (${response.status}).`;
    throw new Error(message);
  }
  return Effect.runPromise(
    Schema.decodeUnknownEffect(InvoiceExtraction)(raw).pipe(
      Effect.mapError(() => new Error("Unexpected response from invoice analysis.")),
    ),
  );
};
