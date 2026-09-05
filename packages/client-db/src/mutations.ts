import {
  ImportInventoryCommandResult,
  type ImportInventoryCommand,
} from "@store/contracts/store.schema";
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
  failureFromUnknown,
  InventoryFailure,
  isAbortError,
  type InventoryFailureReason,
} from "./inventory-failure";

export const inventoryApiRoot = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const readJsonPayload = async (response: Response): Promise<InventoryHttpPayload> => {
  const text = await response.text();
  if (text.trim().length === 0) return null;
  try {
    return Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)).pipe(
      Option.getOrElse(() => text.trim()),
    );
  } catch {
    return text.trim();
  }
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
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
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

export const submitImportInventory = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly command: ImportInventoryCommand;
}) =>
  inventoryRequest({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch: input.authenticatedFetch,
    path: "/inventory/imports",
    body: input.command,
    decode: Schema.decodeUnknownSync(ImportInventoryCommandResult),
    failureLabel: "Inventory import failed.",
  });
