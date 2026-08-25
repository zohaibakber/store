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
import { shouldRetryInventoryUpload, submitCatalogRows } from "./mutations";
import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";

const PowerSyncCredentialsResponse = EffectSchema.Struct({
  endpoint: EffectSchema.String.check(EffectSchema.isMinLength(1)),
  token: EffectSchema.String.check(EffectSchema.isMinLength(1)),
  expiresAt: EffectSchema.Number,
});

const apiRoot = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

export const fetchInventoryPowerSyncCredentials = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
}) => {
  const response = await input.authenticatedFetch(
    `${apiRoot(input.apiBaseUrl)}/powersync/credentials`,
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `PowerSync credentials failed (${response.status}).`);
  }
  const credentials = EffectSchema.decodeUnknownSync(PowerSyncCredentialsResponse)(
    await response.json(),
  );
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
      packPrice: column.integer,
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
        packPrice: null,
        unitPrice: null,
        deletedAt: null,
      };
    case "batches":
      return { batchNumber: null, expiresAt: null, deletedAt: null };
  }
};

type InventoryCrudEntry = Pick<CrudEntry, "id" | "op" | "opData" | "previousValues" | "table">;

export const stampCatalogUploadRow = <Row extends { readonly operationId: string }>(
  row: Row,
): Row => row;

export const decodePowerSyncCatalogCrudEntry = (
  table: "categories" | "products" | "batches",
  entry: InventoryCrudEntry,
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
  const table = catalogTable(entry.table);
  const row = stampCatalogUploadRow(decodePowerSyncCatalogCrudEntry(table, entry));
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
};

export const uploadInventoryCrudTransaction = async (
  input: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
  },
  transaction: {
    readonly crud: ReadonlyArray<InventoryCrudEntry>;
    complete: () => Promise<void>;
  },
) => {
  for (const entry of transaction.crud) {
    try {
      await uploadCatalogCrudEntry(input, entry);
    } catch (error) {
      if (shouldRetryInventoryUpload(error)) throw error;
    }
  }
  await transaction.complete();
};

export const makeInventoryPowerSyncConnector = (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
}): PowerSyncBackendConnector => ({
  fetchCredentials: () => fetchInventoryPowerSyncCredentials(input),
  uploadData: async (database) => {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    await uploadInventoryCrudTransaction(input, transaction);
  },
});

export const inventoryPowerSyncDatabaseName = (scopeId: string) =>
  inventoryReplicaDatabaseName(scopeId).replace("tanstack-inventory", "powersync-inventory");
