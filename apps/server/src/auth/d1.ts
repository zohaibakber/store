/**
 * D1 is bound as `AUTH_DB` on the fetch env and as `AuthDatabase` from
 * QueryDatabase. Clerk org bindings 500 when the adapter sees neither.
 *
 * Accept both names, and only treat a value as D1 if it has the methods the
 * Worker actually calls.
 */
const isObject = <Value>(value: Value): value is Value & object =>
  typeof value === "object" && value !== null;

export const isD1Database = <Value>(value: Value): value is Value & D1Database =>
  isObject(value) &&
  "prepare" in value &&
  "batch" in value &&
  "exec" in value &&
  typeof value.prepare === "function";

export const d1FromEnv = <Environment>(env: Environment | undefined | null) => {
  if (!isObject(env)) return undefined;
  const value =
    ("AuthDatabase" in env ? env.AuthDatabase : undefined) ??
    ("AUTH_DB" in env ? env.AUTH_DB : undefined);
  return isD1Database(value) ? value : undefined;
};
