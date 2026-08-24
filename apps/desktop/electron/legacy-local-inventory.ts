import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  LegacyBatchMigrationRow,
  LegacyCategoryMigrationRow,
  LegacyProductMigrationRow,
} from "@store/contracts";
import Database from "better-sqlite3";
import * as Schema from "effect/Schema";
import type { IpcMain } from "electron";

import { LEGACY_LOCAL_INVENTORY_CHANNEL } from "./legacy-local-inventory-channels";
import { latestMigrationRows } from "./legacy-migration-catalog";

const emptySnapshot = () => ({
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
  migrationCatalog: { categories: [], products: [], batches: [] },
});

const requiredTables = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
] as const;

const isMissingDatabase = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "SQLITE_CANTOPEN");

const ColumnInfo = Schema.Struct({ name: Schema.String });
const SQLiteBoolean = Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]);
const SqliteLegacyCategoryMigrationRow = Schema.Struct({
  ...LegacyCategoryMigrationRow.fields,
  tracksPacks: SQLiteBoolean,
});
const SqliteLegacyProductMigrationRow = Schema.Struct({
  ...LegacyProductMigrationRow.fields,
  visible: SQLiteBoolean,
});
const readCategories = (statement: Database.Statement) =>
  Schema.decodeUnknownSync(Schema.Array(SqliteLegacyCategoryMigrationRow))(statement.all()).map(
    (row) => ({
      ...row,
      tracksPacks: row.tracksPacks === true || row.tracksPacks === 1,
    }),
  );
const readProducts = (statement: Database.Statement) =>
  Schema.decodeUnknownSync(Schema.Array(SqliteLegacyProductMigrationRow))(statement.all()).map(
    (row) => ({
      ...row,
      visible: row.visible === true || row.visible === 1,
    }),
  );
const readBatches = (statement: Database.Statement) =>
  Schema.decodeUnknownSync(Schema.Array(LegacyBatchMigrationRow))(statement.all());

const hasColumns = (
  database: Database.Database,
  table: string,
  required: ReadonlyArray<string>,
) => {
  const columns = new Set(
    Schema.decodeUnknownSync(Schema.Array(ColumnInfo))(
      database.prepare(`PRAGMA table_info(${table})`).all(),
    ).map((column) => column.name),
  );
  return required.every((column) => columns.has(column));
};

const loadMigrationCatalog = (databasePath: string) => {
  if (!existsSync(databasePath)) return emptySnapshot().migrationCatalog;
  const database = new Database(databasePath, { fileMustExist: true, readonly: true });
  try {
    if (
      !requiredTables
        .slice(0, 3)
        .every((table) =>
          database
            .prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?")
            .pluck()
            .get(table),
        )
    )
      return emptySnapshot().migrationCatalog;

    if (hasColumns(database, "categories", ["createdAt", "tracksPacks"])) {
      return {
        categories: readCategories(
          database.prepare(
            `SELECT id, name, tracksPacks, createdAt, updatedAt
               FROM categories WHERE deletedAt IS NULL`,
          ),
        ),
        products: readProducts(
          database.prepare(
            `SELECT id, name, categoryId, aisle, composition, strength, unitsPerPack,
                    packPrice, unitPrice, visible, createdAt, updatedAt
               FROM products WHERE deletedAt IS NULL`,
          ),
        ),
        batches: readBatches(
          database.prepare(
            `SELECT id, productId, batchNumber, expiresAt, packQuantity, unitQuantity,
                    createdAt, updatedAt
               FROM batches WHERE deletedAt IS NULL`,
          ),
        ),
      };
    }

    if (hasColumns(database, "categories", ["createdAt"])) {
      return {
        categories: readCategories(
          database.prepare(
            `SELECT id, name, 1 AS tracksPacks, createdAt, updatedAt
               FROM categories WHERE deletedAt IS NULL`,
          ),
        ),
        products: readProducts(
          database.prepare(
            `SELECT id, name, categoryId, aisle, composition, strength, unitsPerPack,
                    packPrice, unitPrice, visible, createdAt, updatedAt
               FROM products WHERE deletedAt IS NULL`,
          ),
        ),
        batches: readBatches(
          database.prepare(
            `SELECT id, productId, batchNumber, expiresAt, packQuantity, unitQuantity,
                    createdAt, updatedAt
               FROM batches WHERE deletedAt IS NULL`,
          ),
        ),
      };
    }

    if (hasColumns(database, "categories", ["created_at"])) {
      return {
        categories: readCategories(
          database.prepare(
            `SELECT id, name, 1 AS tracksPacks, created_at AS createdAt, updated_at AS updatedAt
               FROM categories WHERE deleted_at IS NULL`,
          ),
        ),
        products: readProducts(
          database.prepare(
            `SELECT id, name, category_id AS categoryId, NULL AS aisle, composition, strength,
                    units_per_pack AS unitsPerPack, pack_price AS packPrice,
                    unit_price AS unitPrice, 1 AS visible,
                    created_at AS createdAt, updated_at AS updatedAt
               FROM products WHERE deleted_at IS NULL`,
          ),
        ),
        batches: readBatches(
          database.prepare(
            `SELECT id, product_id AS productId, batch_number AS batchNumber,
                    expires_at AS expiresAt, 0 AS packQuantity, quantity AS unitQuantity,
                    created_at AS createdAt, updated_at AS updatedAt
               FROM batches WHERE deleted_at IS NULL`,
          ),
        ),
      };
    }

    return emptySnapshot().migrationCatalog;
  } finally {
    database.close();
  }
};

const migrationDatabasePaths = (userDataPath: string) => {
  const organizationsPath = path.join(userDataPath, "organizations");
  const organizationDatabases = existsSync(organizationsPath)
    ? readdirSync(organizationsPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(organizationsPath, entry.name, "store.db"))
    : [];
  return [
    path.join(userDataPath, "locked", "data", "store.db"),
    path.join(userDataPath, "store-v5.db"),
    path.join(userDataPath, "store-v4.db"),
    path.join(userDataPath, "store-v3.db"),
    ...organizationDatabases,
  ];
};

const combinedMigrationCatalog = (userDataPath: string) => {
  const catalogs = migrationDatabasePaths(userDataPath).map(loadMigrationCatalog);
  return {
    categories: latestMigrationRows(catalogs.flatMap((catalog) => catalog.categories)),
    products: latestMigrationRows(catalogs.flatMap((catalog) => catalog.products)),
    batches: latestMigrationRows(catalogs.flatMap((catalog) => catalog.batches)),
  };
};

export const loadLegacyLocalSnapshot = (userDataPath: string) => {
  const databasePath = path.join(userDataPath, "locked", "data", "store.db");
  // better-sqlite3 throws a plain TypeError (without an SQLite/ENOENT code)
  // when fileMustExist points into a missing directory. Treat that normal
  // first-run state as an empty legacy source before opening SQLite.
  const migrationCatalog = combinedMigrationCatalog(userDataPath);
  if (!existsSync(databasePath)) return { ...emptySnapshot(), migrationCatalog };
  let database: Database.Database;
  try {
    database = new Database(databasePath, { fileMustExist: true, readonly: true });
  } catch (cause) {
    if (isMissingDatabase(cause)) return { ...emptySnapshot(), migrationCatalog };
    throw cause;
  }

  try {
    const tableCount = database
      .prepare(
        `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(", ")})`,
      )
      .pluck()
      .get(...requiredTables);
    if (tableCount !== requiredTables.length) return emptySnapshot();

    return {
      categories: database
        .prepare(
          `SELECT id, name, tracksPacks, createdAt, updatedAt, deletedAt,
                  organizationId, createdByUserId, updatedByUserId, deviceId,
                  operationId, rowVersion
             FROM categories
            WHERE organizationId = ?`,
        )
        .all("local"),
      products: database
        .prepare(
          `SELECT id, name, categoryId, aisle, composition, strength, unitsPerPack,
                  packPrice, unitPrice, visible, createdAt, updatedAt, deletedAt,
                  organizationId, createdByUserId, updatedByUserId, deviceId,
                  operationId, rowVersion
             FROM products
            WHERE organizationId = ?`,
        )
        .all("local"),
      batches: database
        .prepare(
          `SELECT id, productId, batchNumber, expiresAt, packQuantity, unitQuantity,
                  createdAt, updatedAt, deletedAt, organizationId, createdByUserId,
                  updatedByUserId, deviceId, operationId, rowVersion
             FROM batches
            WHERE organizationId = ?`,
        )
        .all("local"),
      invoices: database
        .prepare(
          `SELECT id, invoiceNumber, customerName, total, createdAt, updatedAt,
                  deletedAt, organizationId, createdByUserId, updatedByUserId,
                  deviceId, operationId, rowVersion
             FROM invoices
            WHERE organizationId = ?`,
        )
        .all("local"),
      invoiceItems: database
        .prepare(
          `SELECT id, invoiceId, productId, batchId, productName, batchNumber,
                  quantity, quantityType, baseUnitQuantity, salePrice, createdAt,
                  updatedAt, deletedAt, organizationId, createdByUserId,
                  updatedByUserId, deviceId, operationId, rowVersion
             FROM invoice_items
            WHERE organizationId = ?`,
        )
        .all("local"),
      stockMovements: database
        .prepare(
          `SELECT id, productId, batchId, invoiceId, type, packDelta, unitDelta,
                  note, organizationId, actorUserId, deviceId, operationId, createdAt
             FROM stock_movements
            WHERE organizationId = ?`,
        )
        .all("local"),
      migrationCatalog,
    };
  } finally {
    database.close();
  }
};

export const registerLegacyLocalInventoryIpc = (options: {
  readonly ipcMain: IpcMain;
  readonly userDataPath: string;
}) => {
  options.ipcMain.handle(LEGACY_LOCAL_INVENTORY_CHANNEL, () =>
    loadLegacyLocalSnapshot(options.userDataPath),
  );
  return () => options.ipcMain.removeHandler(LEGACY_LOCAL_INVENTORY_CHANNEL);
};
