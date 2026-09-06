import type { CatalogWriteCommand, CatalogWriteEntity } from "@store/contracts/catalog-write";
import {
  ImportInventoryCommandResult,
  IssueInvoiceResult,
  type ImportInventoryCommand,
  type IssueInvoiceCommand,
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
import type { BatchRow, CategoryRow, ProductRow } from "./rows";

export type CatalogMutationEntity = CatalogWriteEntity;
export type CatalogMutationRow = BatchRow | CategoryRow | ProductRow;

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

const InventoryMutationResult = Schema.Struct({
  txid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

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

const submitInventoryCommand = async <Result>(input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly path: "imports" | "invoices";
  readonly command: ImportInventoryCommand | IssueInvoiceCommand;
  readonly decode: (payload: InventoryHttpPayload) => Result;
  readonly failureLabel: string;
}) =>
  inventoryRequest({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch: input.authenticatedFetch,
    path: `/inventory/${input.path}`,
    body: input.command,
    decode: input.decode,
    failureLabel: input.failureLabel,
  });

export const submitCatalogRows = (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly entity: CatalogMutationEntity;
  readonly rows: ReadonlyArray<CatalogMutationRow>;
}) => {
  const first = input.rows[0];
  if (!first) throw new Error("An inventory mutation must contain at least one row.");
  if (input.rows.some((row) => row.operationId !== first.operationId)) {
    throw new Error("Inventory rows from different operations cannot be submitted together.");
  }
  const command: CatalogWriteCommand = {
    operationId: first.operationId,
    organizationId: first.organizationId,
    deviceId: first.deviceId,
    actorUserId: first.updatedByUserId,
    occurredAt: first.updatedAt,
    entity: input.entity,
    rows: input.rows,
  };
  return inventoryRequest({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch: input.authenticatedFetch,
    path: "/inventory/mutations",
    body: command,
    decode: Schema.decodeUnknownSync(InventoryMutationResult),
    failureLabel: "Inventory mutation failed.",
  });
};

export const submitIssueInvoice = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly command: IssueInvoiceCommand;
}) => {
  return submitInventoryCommand({
    ...input,
    path: "invoices",
    decode: Schema.decodeUnknownSync(IssueInvoiceResult),
    failureLabel: "Invoice creation failed.",
  });
};

export const submitImportInventory = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly command: ImportInventoryCommand;
}) =>
  submitInventoryCommand({
    ...input,
    path: "imports",
    decode: Schema.decodeUnknownSync(ImportInventoryCommandResult),
    failureLabel: "Inventory import failed.",
  });
