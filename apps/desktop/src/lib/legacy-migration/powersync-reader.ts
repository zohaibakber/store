import { column, PowerSyncDatabase, Schema, Table } from "@powersync/web";

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

const legacyInventorySchema = new Schema({
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

const LEGACY_TABLES: ReadonlyArray<string> = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
];

const withLegacyDatabase = async <A>(
  dbFilename: string,
  use: (database: PowerSyncDatabase) => Promise<A>,
): Promise<A> => {
  const database = new PowerSyncDatabase({
    database: { dbFilename },
    schema: legacyInventorySchema,
    flags: { enableMultiTabs: false },
  });
  try {
    await database.init();
    return await use(database);
  } finally {
    await database.close();
  }
};

export const readLegacyPowerSyncDatabase = (dbFilename: string) =>
  withLegacyDatabase(dbFilename, async (database) => {
    const crud = await database.getAll<unknown>("select id, tx_id, data from ps_crud order by id");
    const tables: Record<string, ReadonlyArray<unknown>> = {};
    for (const table of LEGACY_TABLES) {
      tables[table] = await database.getAll<unknown>(`select * from ${table}`);
    }
    return { name: dbFilename, crud, tables };
  });

export const probeLegacyPowerSyncDatabase = (dbFilename: string) =>
  withLegacyDatabase(dbFilename, async (database) => ({
    pendingWrites: (await database.getAll<unknown>("select id from ps_crud limit 1")).length,
    invoiceRows: (await database.getAll<unknown>("select id from invoices limit 1")).length,
  }));
