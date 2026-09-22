import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  failureFromUnknown,
  InventoryFailure,
  inventoryFailureFromHttp,
  isAbortError,
  type InventoryHttpPayload,
} from "./inventory-failure";

export {
  catalogUploadDisposition,
  failureFromUnknown,
  InventoryFailure,
  invoiceUploadDisposition,
  isAbortError,
  type CatalogUploadDisposition,
  type InventoryFailureReason,
  type InvoiceUploadDisposition,
} from "./inventory-failure";

export const inventoryApiRoot = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json));
const decodeJsonPayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const readJsonPayload = async (response: Response): Promise<InventoryHttpPayload> => {
  const text = await response.text();
  if (text.trim().length === 0) return null;
  return decodeJsonPayload(text).pipe(Option.getOrElse(() => text.trim()));
};

export const inventoryRequest = async <Result>(input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  readonly decode: (payload: InventoryHttpPayload) => Result;
  readonly failureLabel: string;
}): Promise<Result> => {
  let response: Response;
  try {
    response = await input.authenticatedFetch(
      `${inventoryApiRoot(input.apiBaseUrl)}${input.path}`,
      {
        method: input.method ?? "POST",
        headers: input.body === undefined ? undefined : { "content-type": "application/json" },
        body:
          input.body === undefined
            ? undefined
            : encodeJsonBody(input.body as InventoryHttpPayload),
      },
    );
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw failureFromUnknown(cause);
  }
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw inventoryFailureFromHttp(response.status, payload, input.failureLabel);
  }
  try {
    return input.decode(payload);
  } catch {
    throw new InventoryFailure({
      message: input.failureLabel,
      reason: { _tag: "rejected", code: "INVALID_JSON_RESPONSE" },
    });
  }
};
