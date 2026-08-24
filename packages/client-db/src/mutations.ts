import {
  LegacyCatalogMigrationResult,
  LegacyCatalogReconciliationResult,
  type LegacyCatalogMigrationCommand,
  type LegacyCatalogReconciliationCommand,
} from "@store/contracts";
import { operationPayloadHash } from "@store/contracts/operation-hash";
import {
  ImportInventoryCommandResult,
  IssueInvoiceResult,
  type ImportInventoryCommand,
  type IssueInvoiceCommand,
} from "@store/contracts/store.schema";
import type { SyncEntityChange, SyncOperation } from "@store/contracts/sync.schema";
import * as Schema from "effect/Schema";

import type { BatchRow, CategoryRow, ProductRow } from "./rows";

export type CatalogMutationEntity = "category" | "product" | "batch";
export type CatalogMutationRow = BatchRow | CategoryRow | ProductRow;

const InventoryMutationResult = Schema.Struct({
  txid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

const InventoryErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
  }),
});

export const isIgnorableCatalogUploadError = (cause: unknown) => {
  const text = cause instanceof Error ? cause.message : String(cause);
  try {
    const body = Schema.decodeUnknownSync(InventoryErrorBody)(JSON.parse(text));
    return body.error.code === "OPERATION_ID_REUSED";
  } catch {
    return false;
  }
};

const apiRoot = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const submitInventoryCommand = async <Result>(input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly path: "imports" | "invoices";
  readonly command: ImportInventoryCommand | IssueInvoiceCommand;
  readonly decode: (input: typeof Schema.Json.Type) => Result;
  readonly failureLabel: string;
}) => {
  const response = await input.authenticatedFetch(
    `${apiRoot(input.apiBaseUrl)}/inventory/${input.path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.command),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `${input.failureLabel} (${response.status}).`);
  }
  return input.decode(Schema.decodeUnknownSync(Schema.Json)(await response.json()));
};

export const submitInventoryOperation = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly operation: SyncOperation;
}) => {
  const response = await input.authenticatedFetch(
    `${apiRoot(input.apiBaseUrl)}/inventory/mutations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: input.operation }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Inventory mutation failed (${response.status}).`);
  }
  return Schema.decodeUnknownSync(InventoryMutationResult)(await response.json());
};

export const submitLegacyCatalogMigration = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly command: LegacyCatalogMigrationCommand;
}) => {
  const response = await input.authenticatedFetch(
    `${apiRoot(input.apiBaseUrl)}/inventory/legacy-migrations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.command),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Legacy inventory migration failed (${response.status}).`);
  }
  return Schema.decodeUnknownSync(LegacyCatalogMigrationResult)(await response.json());
};

export const submitLegacyCatalogReconciliation = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly command: LegacyCatalogReconciliationCommand;
}) => {
  const response = await input.authenticatedFetch(
    `${apiRoot(input.apiBaseUrl)}/inventory/legacy-reconciliations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.command),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Legacy inventory reconciliation failed (${response.status}).`);
  }
  return Schema.decodeUnknownSync(LegacyCatalogReconciliationResult)(await response.json());
};

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
  const changes: ReadonlyArray<SyncEntityChange> = input.rows.map((row) => ({
    entity: input.entity,
    action: row.deletedAt === null ? "upsert" : "delete",
    entityId: row.id,
    rowVersion: row.rowVersion,
    row,
  }));
  const unhashed = {
    operationId: first.operationId,
    organizationId: first.organizationId,
    deviceId: first.deviceId,
    actorUserId: first.updatedByUserId,
    clientSequence: first.updatedAt,
    occurredAt: first.updatedAt,
    changes,
  } satisfies Omit<SyncOperation, "payloadHash">;
  return submitInventoryOperation({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch: input.authenticatedFetch,
    operation: { ...unhashed, payloadHash: operationPayloadHash(unhashed) },
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
    failureLabel: "Invoice creation failed",
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
    failureLabel: "Inventory import failed",
  });
