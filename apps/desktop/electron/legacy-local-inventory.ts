import { existsSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import type { IpcMain } from "electron";

import { assertTrustedIpcSender } from "./ipc-sender";
import { LEGACY_LOCAL_INVENTORY_CHANNEL } from "./legacy-local-inventory-channels";

const emptySnapshot = () => ({
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
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

export const lockedLocalDatabasePath = (userDataPath: string) =>
  path.join(userDataPath, "locked", "data", "store.db");

export const loadLegacyLocalSnapshot = (userDataPath: string) => {
  const databasePath = lockedLocalDatabasePath(userDataPath);
  // better-sqlite3 throws a plain TypeError (without an SQLite/ENOENT code)
  // when fileMustExist points into a missing directory. Treat that normal
  // first-run state as an empty legacy source before opening SQLite.
  if (!existsSync(databasePath)) return emptySnapshot();
  let database: Database.Database;
  try {
    database = new Database(databasePath, { fileMustExist: true, readonly: true });
  } catch (cause) {
    if (isMissingDatabase(cause)) return emptySnapshot();
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
    };
  } finally {
    database.close();
  }
};

export const registerLegacyLocalInventoryIpc = (options: {
  readonly ipcMain: IpcMain;
  readonly userDataPath: string;
  readonly allowedOrigins: () => ReadonlyArray<string>;
}) => {
  options.ipcMain.handle(LEGACY_LOCAL_INVENTORY_CHANNEL, (event) => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    return loadLegacyLocalSnapshot(options.userDataPath);
  });
  return () => options.ipcMain.removeHandler(LEGACY_LOCAL_INVENTORY_CHANNEL);
};
