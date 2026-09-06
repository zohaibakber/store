import {
  Schema,
  Table,
  UpdateType,
  column,
  type CrudEntry,
  type PowerSyncBackendConnector,
} from "@powersync/common";
import * as EffectSchema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { inventoryReplicaDatabaseName } from "./inventory";
import { classifyInventoryCrudTransaction, saleSnapshotFromCrud } from "./invoice-projection";
import {
  catalogUploadDisposition,
  failureFromUnknown,
  InventoryFailure,
  invoiceUploadDisposition,
  isAbortError,
  inventoryRequest,
  submitCatalogRows,
  submitIssueInvoice,
} from "./mutations";
import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";
import type { SaleOutboxStore } from "./sale-outbox";

const PowerSyncCredentialsResponse = EffectSchema.Struct({
  endpoint: EffectSchema.String.check(EffectSchema.isMinLength(1)),
  token: EffectSchema.String.check(EffectSchema.isMinLength(1)),
  expiresAt: EffectSchema.Number,
});

export const fetchInventoryPowerSyncCredentials = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
}) => {
  const credentials = await inventoryRequest({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch: input.authenticatedFetch,
    path: "/powersync/credentials",
    method: "GET",
    decode: EffectSchema.decodeUnknownSync(PowerSyncCredentialsResponse),
    failureLabel: "PowerSync credentials failed.",
  });
  return {
    endpoint: credentials.endpoint,
    token: credentials.token,
    expiresAt: new Date(credentials.expiresAt),
  };
};

const mutableColumns = {
  organizationId: column.text,
  createdByUserId: column.text,
  updatedByUserId: column.text,
  deviceId: column.text,
  operationId: column.text,
  rowVersion: column.integer,
  createdAt: column.integer,
  updatedAt: column.integer,
  deletedAt: column.integer,
};

export const inventoryPowerSyncSchema = new Schema({
  categories: new Table(
    {
      name: column.text,
      tracksPacks: column.integer,
      ...mutableColumns,
    },
    { trackPrevious: true },
  ),
  products: new Table(
    {
      name: column.text,
      categoryId: column.text,
      aisle: column.text,
      composition: column.text,
      strength: column.text,
      unitsPerPack: column.integer,
      purchasePrice: column.integer,
      retailPrice: column.integer,
      unitPrice: column.integer,
      visible: column.integer,
      ...mutableColumns,
    },
    { trackPrevious: true },
  ),
  batches: new Table(
    {
      productId: column.text,
      batchNumber: column.text,
      expiresAt: column.integer,
      packQuantity: column.integer,
      unitQuantity: column.integer,
      ...mutableColumns,
    },
    { trackPrevious: true },
  ),
  invoices: new Table({
    invoiceNumber: column.integer,
    customerName: column.text,
    total: column.integer,
    ...mutableColumns,
  }),
  sale_outbox: new Table(
    {
      payload: column.text,
      createdAt: column.integer,
    },
    { localOnly: true },
  ),
  invoice_items: new Table({
    invoiceId: column.text,
    productId: column.text,
    batchId: column.text,
    productName: column.text,
    batchNumber: column.text,
    quantity: column.integer,
    quantityType: column.text,
    baseUnitQuantity: column.integer,
    salePrice: column.integer,
    ...mutableColumns,
  }),
  stock_movements: new Table({
    productId: column.text,
    batchId: column.text,
    invoiceId: column.text,
    type: column.text,
    packDelta: column.integer,
    unitDelta: column.integer,
    note: column.text,
    organizationId: column.text,
    actorUserId: column.text,
    deviceId: column.text,
    operationId: column.text,
    createdAt: column.integer,
  }),
});

const SQLiteBoolean = EffectSchema.Number.check(
  EffectSchema.isInt(),
  EffectSchema.makeFilter((value) => value === 0 || value === 1, {
    title: "SQLite boolean",
  }),
);

export const PowerSyncCategoryRow = EffectSchema.Struct({
  ...CategoryRow.fields,
  id: EffectSchema.toEncoded(CategoryRow.fields.id),
  tracksPacks: SQLiteBoolean,
}).pipe(
  EffectSchema.decodeTo(CategoryRow, {
    decode: SchemaGetter.transform((row) => ({ ...row, tracksPacks: row.tracksPacks === 1 })),
    encode: SchemaGetter.transform((row) => ({ ...row, tracksPacks: row.tracksPacks ? 1 : 0 })),
  }),
);

export const PowerSyncProductRow = EffectSchema.Struct({
  ...ProductRow.fields,
  id: EffectSchema.toEncoded(ProductRow.fields.id),
  categoryId: EffectSchema.toEncoded(ProductRow.fields.categoryId),
  visible: SQLiteBoolean,
}).pipe(
  EffectSchema.decodeTo(ProductRow, {
    decode: SchemaGetter.transform((row) => ({ ...row, visible: row.visible === 1 })),
    encode: SchemaGetter.transform((row) => ({ ...row, visible: row.visible ? 1 : 0 })),
  }),
);

interface StandardSchema<Input, Output> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: "@store/client-db";
    readonly types?: { readonly input: Input; readonly output: Output };
    readonly validate: <Value>(
      value: Value,
    ) =>
      | { readonly value: Output }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> };
  };
}

const toStandardSchema = <Input, Output>(
  decode: <Value>(value: Value) => Output,
): StandardSchema<Input, Output> => ({
  "~standard": {
    version: 1,
    vendor: "@store/client-db",
    validate: (value) => {
      try {
        return { value: decode(value) };
      } catch (cause) {
        return { issues: [{ message: cause instanceof Error ? cause.message : String(cause) }] };
      }
    },
  },
});

export const powerSyncCollectionSchemas = {
  categories: toStandardSchema<CategoryRow, CategoryRow>(
    EffectSchema.decodeUnknownSync(CategoryRow),
  ),
  products: toStandardSchema<ProductRow, ProductRow>(EffectSchema.decodeUnknownSync(ProductRow)),
  batches: toStandardSchema<BatchRow, BatchRow>(EffectSchema.decodeUnknownSync(BatchRow)),
  invoices: toStandardSchema<InvoiceRow, InvoiceRow>(EffectSchema.decodeUnknownSync(InvoiceRow)),
  invoiceItems: toStandardSchema<InvoiceItemRow, InvoiceItemRow>(
    EffectSchema.decodeUnknownSync(InvoiceItemRow),
  ),
  stockMovements: toStandardSchema<StockMovementRow, StockMovementRow>(
    EffectSchema.decodeUnknownSync(StockMovementRow),
  ),
} as const;

export const powerSyncDeserializationSchemas = {
  categories: toStandardSchema<typeof inventoryPowerSyncSchema.types.categories, CategoryRow>(
    EffectSchema.decodeUnknownSync(PowerSyncCategoryRow),
  ),
  products: toStandardSchema<typeof inventoryPowerSyncSchema.types.products, ProductRow>(
    EffectSchema.decodeUnknownSync(PowerSyncProductRow),
  ),
  batches: toStandardSchema<typeof inventoryPowerSyncSchema.types.batches, BatchRow>(
    EffectSchema.decodeUnknownSync(BatchRow),
  ),
  invoices: toStandardSchema<typeof inventoryPowerSyncSchema.types.invoices, InvoiceRow>(
    EffectSchema.decodeUnknownSync(InvoiceRow),
  ),
  invoiceItems: toStandardSchema<
    typeof inventoryPowerSyncSchema.types.invoice_items,
    InvoiceItemRow
  >(EffectSchema.decodeUnknownSync(InvoiceItemRow)),
  stockMovements: toStandardSchema<
    typeof inventoryPowerSyncSchema.types.stock_movements,
    StockMovementRow
  >(EffectSchema.decodeUnknownSync(StockMovementRow)),
} as const;

export const powerSyncDeserializationFailure = (error: {
  readonly issues: ReadonlyArray<unknown>;
}) => {
  throw new Error(`PowerSync returned an invalid inventory row (${error.issues.length} issues).`);
};

export const decodePowerSyncCatalogRow = <Value>(
  table: "categories" | "products" | "batches",
  input: Value,
) => {
  switch (table) {
    case "categories":
      return EffectSchema.decodeUnknownSync(PowerSyncCategoryRow)(input);
    case "products":
      return EffectSchema.decodeUnknownSync(PowerSyncProductRow)(input);
    case "batches":
      return EffectSchema.decodeUnknownSync(BatchRow)(input);
  }
};

const catalogTable = (table: string) => {
  switch (table) {
    case "categories":
    case "products":
    case "batches":
      return table;
    default:
      throw new Error(`PowerSync queued an unsupported local write to ${table}.`);
  }
};

const catalogNulls = (table: "categories" | "products" | "batches") => {
  switch (table) {
    case "categories":
      return { deletedAt: null };
    case "products":
      return {
        aisle: null,
        composition: null,
        strength: null,
        purchasePrice: null,
        retailPrice: null,
        unitPrice: null,
        deletedAt: null,
      };
    case "batches":
      return { batchNumber: null, expiresAt: null, deletedAt: null };
  }
};

type InventoryCrudSnapshot = Pick<CrudEntry, "id" | "op" | "opData" | "previousValues">;
type InventoryCrudEntry = InventoryCrudSnapshot & Pick<CrudEntry, "table">;

export const decodePowerSyncCatalogCrudEntry = (
  table: "categories" | "products" | "batches",
  entry: InventoryCrudSnapshot,
) => {
  if (entry.op === UpdateType.DELETE) {
    throw new Error(`Use a soft delete for queued inventory row ${table}/${entry.id}.`);
  }
  if (!entry.opData) throw new Error(`PowerSync queued ${table}/${entry.id} without row data.`);
  if (entry.op === UpdateType.PATCH && !entry.previousValues) {
    throw new Error(`PowerSync queued ${table}/${entry.id} without its previous row snapshot.`);
  }
  return decodePowerSyncCatalogRow(table, {
    ...catalogNulls(table),
    ...entry.previousValues,
    ...entry.opData,
    id: entry.id,
  });
};

const uploadCatalogCrudEntry = async (
  input: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
  },
  entry: InventoryCrudEntry,
) => {
  try {
    const table = catalogTable(entry.table);
    const row = decodePowerSyncCatalogCrudEntry(table, entry);
    switch (table) {
      case "categories":
        await submitCatalogRows({ ...input, entity: "category", rows: [row] });
        break;
      case "products":
        await submitCatalogRows({ ...input, entity: "product", rows: [row] });
        break;
      case "batches":
        await submitCatalogRows({ ...input, entity: "batch", rows: [row] });
        break;
    }
  } catch (cause) {
    if (cause instanceof InventoryFailure || isAbortError(cause)) throw cause;
    throw new InventoryFailure({
      message: cause instanceof Error ? cause.message : "Catalog upload is invalid.",
      reason: { _tag: "rejected", code: "CLIENT_UPLOAD_INVALID" },
    });
  }
};

const saleUploadFailure = (cause: unknown): InventoryFailure => {
  if (isAbortError(cause)) throw cause;
  if (cause instanceof InventoryFailure) return cause;
  return new InventoryFailure({
    message: cause instanceof Error ? cause.message : "Invoice upload is invalid.",
    reason: { _tag: "rejected", code: "CLIENT_UPLOAD_INVALID" },
  });
};

export const uploadInventoryCrudTransaction = async (
  input: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
    readonly saleOutbox?: SaleOutboxStore;
  },
  transaction: {
    readonly crud: ReadonlyArray<InventoryCrudEntry>;
    complete: () => Promise<void>;
  },
) => {
  let classified;
  try {
    classified = classifyInventoryCrudTransaction(transaction.crud);
  } catch (cause) {
    throw saleUploadFailure(cause);
  }
  if (classified._tag === "sale") {
    await input.saleOutbox?.put(saleSnapshotFromCrud(transaction.crud));
    try {
      await submitIssueInvoice({ ...input, command: classified.command });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw failureFromUnknown(error);
    }
    await transaction.complete();
    await input.saleOutbox?.remove(classified.command.commandId);
    return;
  }
  for (const entry of transaction.crud) {
    try {
      await uploadCatalogCrudEntry(input, entry);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const failure = failureFromUnknown(error);
      const fate = catalogUploadDisposition(failure);
      if (fate._tag === "skip") continue;
      throw failure;
    }
  }
  await transaction.complete();
};

export type InventoryPowerSyncUploadSource = {
  readonly getNextCrudTransaction: () => Promise<{
    readonly crud: ReadonlyArray<InventoryCrudEntry>;
    complete: () => Promise<void>;
  } | null>;
  disconnect: () => Promise<void>;
};

type InventoryPowerSyncConnectorInput = {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly saleOutbox?: SaleOutboxStore;
  readonly onUploadHalt?: (failure: InventoryFailure) => void;
};

export const uploadInventoryData = async (
  input: InventoryPowerSyncConnectorInput,
  database: InventoryPowerSyncUploadSource,
) => {
  const transaction = await database.getNextCrudTransaction();
  if (!transaction) return;
  try {
    await uploadInventoryCrudTransaction(
      {
        apiBaseUrl: input.apiBaseUrl,
        authenticatedFetch: input.authenticatedFetch,
        saleOutbox: input.saleOutbox,
      },
      transaction,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    const failure = failureFromUnknown(error);
    const saleHead = transaction.crud.some(
      (entry) =>
        entry.table === "invoices" ||
        entry.table === "invoice_items" ||
        entry.table === "stock_movements",
    );
    const fate = saleHead ? invoiceUploadDisposition(failure) : catalogUploadDisposition(failure);
    if (fate._tag === "halt") {
      input.onUploadHalt?.(failure);
      await database.disconnect();
    }
    throw failure;
  }
};

export const makeInventoryPowerSyncConnector = (
  input: InventoryPowerSyncConnectorInput,
): PowerSyncBackendConnector => ({
  fetchCredentials: () => fetchInventoryPowerSyncCredentials(input),
  uploadData: (database) => uploadInventoryData(input, database),
});

export const inventoryPowerSyncDatabaseName = inventoryReplicaDatabaseName;

export type InventoryPowerSyncLifecycle = {
  disconnectAndClear: (options?: { clearLocal?: boolean }) => Promise<void>;
  close: () => Promise<void>;
};

export const runInventoryCleanupActions = async (actions: ReadonlyArray<() => Promise<void>>) => {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Inventory cleanup failed.");
  }
};

/** Stops sync, wipes synced rows, then closes. Call on logout or org change. */
export const disconnectAndClearInventoryPowerSync = async (
  powerSync: InventoryPowerSyncLifecycle,
) => {
  await runInventoryCleanupActions([() => powerSync.disconnectAndClear(), () => powerSync.close()]);
};

export const INVENTORY_FIRST_SYNC_TIMEOUT_MS = 300_000;
export const INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE = "The first sync did not finish in time.";
export const INVENTORY_UPLOAD_DRAIN_TIMEOUT_MS = 15_000;
const INVENTORY_UPLOAD_DRAIN_POLL_MS = 50;

export const waitForInventoryFirstSync = async (
  powerSync: {
    readonly waitForFirstSync: (request?: AbortSignal) => Promise<void>;
    readonly currentStatus: { readonly hasSynced?: boolean | null };
  },
  timeoutMs: number = INVENTORY_FIRST_SYNC_TIMEOUT_MS,
) => {
  const signal = AbortSignal.timeout(timeoutMs);
  await powerSync.waitForFirstSync(signal);
  if (powerSync.currentStatus.hasSynced) return;
  throw new Error(INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE);
};

export type InventoryUploadDrainSource = {
  readonly getUploadQueueStats: () => Promise<{ readonly count: number }>;
  readonly currentStatus: {
    readonly connected: boolean;
    readonly connecting: boolean;
  };
};

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Imports still POST to Postgres. Local catalog edits and sales sit in the
 * PowerSync upload queue until the connector `complete()`s them. Drain with
 * `getUploadQueueStats` so the connector keeps the queued transaction.
 */
export const waitForInventoryUploadDrain = async (
  powerSync: InventoryUploadDrainSource,
  timeoutMs: number = INVENTORY_UPLOAD_DRAIN_TIMEOUT_MS,
) => {
  const pending = async () => (await powerSync.getUploadQueueStats()).count;
  if ((await pending()) === 0) return;
  if (!powerSync.currentStatus.connected && !powerSync.currentStatus.connecting) {
    throw new Error("Wait until catalog changes finish uploading before continuing.");
  }
  const deadline = Date.now() + timeoutMs;
  while ((await pending()) > 0) {
    if (Date.now() >= deadline) {
      throw new Error("Catalog changes are still uploading. Try again in a moment.");
    }
    await pause(INVENTORY_UPLOAD_DRAIN_POLL_MS);
  }
};
