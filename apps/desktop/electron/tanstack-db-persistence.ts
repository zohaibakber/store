import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { exposeElectronSQLitePersistence } from "@tanstack/electron-db-sqlite-persistence/main";
import { createNodeSQLitePersistence } from "@tanstack/node-db-sqlite-persistence";
import Database from "better-sqlite3";
import { type IpcMain } from "electron";

import { TANSTACK_DB_PERSISTENCE_CHANNEL } from "./tanstack-db-channels";

export interface DesktopTanStackDbPersistence {
  readonly dispose: () => Promise<void>;
}

const isMissingFile = (cause: unknown): cause is NodeJS.ErrnoException =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const isCorruptSQLiteDatabase = (cause: unknown): boolean => {
  if (!(cause instanceof Database.SqliteError)) return false;
  return (
    cause.code === "SQLITE_CORRUPT" ||
    cause.code === "SQLITE_NOTADB" ||
    /database disk image is malformed|file is not a database/iu.test(cause.message)
  );
};

const openCatalogDatabase = (databasePath: string) => {
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("quick_check");
    return database;
  } catch (cause) {
    database.close();
    throw cause;
  }
};

const quarantineCatalogDatabase = async (databasePath: string) => {
  const suffix = `.corrupt-${new Date().toISOString().replace(/:/gu, "-")}`;
  await Promise.all(
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map(async (filePath) => {
      try {
        await rename(filePath, `${filePath}${suffix}`);
      } catch (cause) {
        if (!isMissingFile(cause)) throw cause;
      }
    }),
  );
};

const openRecoverableCatalogDatabase = async (databasePath: string) => {
  try {
    return openCatalogDatabase(databasePath);
  } catch (cause) {
    if (!isCorruptSQLiteDatabase(cause)) throw cause;
    await quarantineCatalogDatabase(databasePath);
    return openCatalogDatabase(databasePath);
  }
};

export const openDesktopTanStackDbPersistence = async (options: {
  readonly ipcMain: IpcMain;
  readonly userDataPath: string;
}): Promise<DesktopTanStackDbPersistence> => {
  const directory = path.join(options.userDataPath, "tanstack-db");
  await mkdir(directory, { recursive: true });

  const database = await openRecoverableCatalogDatabase(path.join(directory, "catalog.sqlite"));

  try {
    const persistence = createNodeSQLitePersistence({ database });
    const removeIpcHandler = exposeElectronSQLitePersistence({
      channel: TANSTACK_DB_PERSISTENCE_CHANNEL,
      ipcMain: options.ipcMain,
      persistence,
    });
    let disposed = false;

    return {
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        removeIpcHandler();
        database.close();
      },
    };
  } catch (cause) {
    database.close();
    throw cause;
  }
};
