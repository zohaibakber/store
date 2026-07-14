import { PGlite } from "@electric-sql/pglite";
import * as Effect from "effect/Effect";
import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { PGlite as PGlite04 } from "pglite-04";
import { pgDump } from "pglite-tools-04/pg_dump";
import { persistenceError } from "./errors";
import { pgliteExtensions } from "./pglite-extensions";
import type {} from "./pglite-tools-04";

const legacyPostgresMajor = "17";
const currentPostgresMajor = "18";

const isMissingFile = (cause: unknown) =>
  typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT";

const readPostgresMajor = async (dataDir: string): Promise<string | undefined> => {
  try {
    return (await readFile(path.join(dataDir, "PG_VERSION"), "utf8")).trim();
  } catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw cause;
  }
};

const pathExists = async (target: string) => {
  try {
    await readFile(path.join(target, "PG_VERSION"));
    return true;
  } catch (cause) {
    if (isMissingFile(cause)) return false;
    throw cause;
  }
};

const availableBackupPath = async (dataDir: string) => {
  const preferred = `${dataDir}.pg17-backup`;
  if (!(await pathExists(preferred))) return preferred;
  return `${preferred}-${Date.now()}`;
};

const dumpLegacyDatabase = async (dataDir: string) => {
  const database = await PGlite04.create(dataDir);
  try {
    return await (await pgDump({ pg: database })).text();
  } finally {
    await database.close();
  }
};

const restoreCurrentDatabase = async (dataDir: string, dump: string) => {
  const database = await PGlite.create({
    dataDir,
    extensions: pgliteExtensions,
  });
  try {
    await database.exec(dump);
    await database.exec("SET search_path TO public");
    await database.query("SELECT 1");
  } finally {
    await database.close();
  }
};

const swapDatabaseDirectories = async (dataDir: string, stagingDir: string) => {
  const backupDir = await availableBackupPath(dataDir);
  await rename(dataDir, backupDir);
  try {
    await rename(stagingDir, dataDir);
  } catch (cause) {
    await rename(backupDir, dataDir);
    throw cause;
  }
};

const upgrade = async (dataDir: string) => {
  const version = await readPostgresMajor(dataDir);
  if (version === undefined || version === currentPostgresMajor) return;
  if (version !== legacyPostgresMajor) {
    throw new Error(`Unsupported local PostgreSQL data version ${version}.`);
  }

  const stagingDir = `${dataDir}.pg18-upgrade`;
  await rm(stagingDir, { force: true, recursive: true });

  try {
    const dump = await dumpLegacyDatabase(dataDir);
    await restoreCurrentDatabase(stagingDir, dump);
    await swapDatabaseDirectories(dataDir, stagingDir);
  } catch (cause) {
    await rm(stagingDir, { force: true, recursive: true });
    throw cause;
  }
};

export const upgradePgliteDataDir = (dataDir: string) =>
  Effect.tryPromise({
    try: () => upgrade(dataDir),
    catch: (cause) => persistenceError("upgrade local database", cause),
  });
