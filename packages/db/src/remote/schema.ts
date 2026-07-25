// Postgres store + sync tables for the current sync server. Auth is NOT exported
// here any more: it moved to D1/SQLite (`auth.schema.ts`) and a barrel cannot
// mix dialects without breaking drizzle-kit migration generation.
export * from "../shared/store.schema.pg";
export * from "./sync.schema";
