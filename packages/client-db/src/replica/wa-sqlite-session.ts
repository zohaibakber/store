import * as SQLite from "@journeyapps/wa-sqlite";
import SQLiteAsyncESMFactory from "@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { decodeSqliteResultRow, SqliteCell } from "./sqlite-row";
import type { SqliteParameter, SqliteResultRow } from "./types";

type WaSqliteApi = ReturnType<typeof SQLite.Factory>;
type WaSqliteVfs = Parameters<WaSqliteApi["vfs_register"]>[0];
type WaSqliteRowValue = ReturnType<WaSqliteApi["row"]>[number];
type WaSqliteEmscriptenModule = Parameters<typeof SQLite.Factory>[0];

export type WaSqliteSession = {
  readonly query: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => Promise<ReadonlyArray<SqliteResultRow>>;
  readonly close: () => Promise<void>;
};

export type WaSqliteVfsKind = "memory" | "idb";

type WaSqliteVfsHandle = {
  readonly name: string;
  mxPathname?: number;
  readonly close: () => void | Promise<void>;
};

type VfsCreateOptions = {
  readonly lockPolicy?: "shared" | "exclusive" | "multiple";
  readonly idbName?: string;
};

type WaSqliteVfsFactory = {
  readonly name: string;
  readonly create: (
    name: string,
    sqliteModule: WaSqliteEmscriptenModule,
    options?: VfsCreateOptions,
  ) => Promise<WaSqliteVfsHandle>;
};

const SQLITE_PATHNAME_LIMIT = 512;

const toBindValue = (value: SqliteParameter): string | number | bigint | Uint8Array | null => value;

const toCell = (value: WaSqliteRowValue): SqliteCell => {
  const cell = Schema.decodeUnknownOption(SqliteCell)(value);
  if (Option.isSome(cell)) return cell.value;
  const asBigInt = Schema.decodeUnknownOption(Schema.BigInt)(value);
  if (Option.isSome(asBigInt)) return Number(asBigInt.value);
  const asBytes = Schema.decodeUnknownOption(Schema.Array(Schema.Number))(value);
  if (Option.isSome(asBytes)) return Uint8Array.from(asBytes.value);
  throw new Error("SQLite returned an unsupported cell.");
};

const rowFromStatement = (sqlite3: WaSqliteApi, stmt: number): SqliteResultRow => {
  const names = sqlite3.column_names(stmt);
  const values = sqlite3.row(stmt);
  const record: Record<string, SqliteCell> = {};
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (name === undefined) continue;
    record[name] = toCell(values[index] ?? null);
  }
  return decodeSqliteResultRow(record);
};

const NodeProcess = Schema.Struct({
  versions: Schema.Struct({
    node: Schema.String,
  }),
  type: Schema.optionalKey(Schema.String),
});

const shouldLoadWasmFromFilesystem = (): boolean => {
  const decoded = Schema.decodeUnknownOption(NodeProcess)(globalThis.process);
  if (Option.isNone(decoded)) return false;
  return decoded.value.type !== "renderer";
};

const loadWaSqliteModule = async (): Promise<WaSqliteEmscriptenModule> => {
  if (shouldLoadWasmFromFilesystem()) {
    const [{ createRequire }, { readFile }] = await Promise.all([
      import("node:module"),
      import("node:fs/promises"),
    ]);
    const wasmPath = createRequire(import.meta.url).resolve(
      "@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm",
    );
    return SQLiteAsyncESMFactory({ wasmBinary: await readFile(wasmPath) });
  }
  return SQLiteAsyncESMFactory();
};

const isVfsFactory = (value: { readonly name: string }): value is WaSqliteVfsFactory =>
  "create" in value && typeof value.create === "function";

const isRegisteredVfs = (value: WaSqliteVfsHandle): value is WaSqliteVfs => "xOpen" in value;

const openVfs = async (
  factory: { readonly name: string },
  name: string,
  sqliteModule: WaSqliteEmscriptenModule,
  options?: VfsCreateOptions,
): Promise<WaSqliteVfsHandle> => {
  if (!isVfsFactory(factory)) {
    throw new Error("wa-sqlite VFS factory is missing create.");
  }
  const vfs = await factory.create(name, sqliteModule, options);
  vfs.mxPathname = SQLITE_PATHNAME_LIMIT;
  return vfs;
};

const createVfs = async (
  kind: WaSqliteVfsKind,
  databaseName: string,
  sqliteModule: WaSqliteEmscriptenModule,
): Promise<WaSqliteVfsHandle> => {
  if (kind === "idb") {
    const { IDBBatchAtomicVFS } =
      await import("@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js");
    return openVfs(IDBBatchAtomicVFS, `idb-${crypto.randomUUID()}`, sqliteModule, {
      lockPolicy: "exclusive",
      idbName: databaseName,
    });
  }
  const { MemoryAsyncVFS } = await import("@journeyapps/wa-sqlite/src/examples/MemoryAsyncVFS.js");
  return openVfs(MemoryAsyncVFS, `memory-${crypto.randomUUID()}`, sqliteModule);
};

export const openWaSqliteSession = async (
  databaseName: string,
  vfsKind: WaSqliteVfsKind,
): Promise<WaSqliteSession> => {
  const wasm = await loadWaSqliteModule();
  const sqlite3 = SQLite.Factory(wasm);
  const vfsHandle = await createVfs(vfsKind, databaseName, wasm);
  if (!isRegisteredVfs(vfsHandle)) {
    throw new Error("wa-sqlite VFS is missing xOpen.");
  }
  sqlite3.vfs_register(vfsHandle, true);
  const db = await sqlite3.open_v2(
    databaseName,
    SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_CREATE,
    vfsHandle.name,
  );
  await sqlite3.exec(db, "PRAGMA foreign_keys = ON");
  return {
    query: async (sql, parameters) => {
      const result: Array<SqliteResultRow> = [];
      const bindings = parameters.map(toBindValue);
      for await (const stmt of sqlite3.statements(db, sql)) {
        if (bindings.length > 0) sqlite3.bind_collection(stmt, bindings);
        while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
          result.push(rowFromStatement(sqlite3, stmt));
        }
      }
      return result;
    },
    close: async () => {
      await sqlite3.close(db);
      await vfsHandle.close();
    },
  };
};
