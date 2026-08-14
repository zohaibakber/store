/**
 * D1 is bound as `AUTH_DB` on the fetch env and as `AuthDatabase` from
 * QueryDatabase. Clerk org bindings 500 when the adapter sees neither.
 *
 * Accept both names, and only treat a value as D1 if it has the methods the
 * Worker actually calls.
 */
export const isD1Database = (value: unknown): value is D1Database =>
  typeof value === "object" &&
  value !== null &&
  "prepare" in value &&
  "batch" in value &&
  "exec" in value &&
  typeof (value as D1Database).prepare === "function";

export const d1FromEnv = (env: Record<string, unknown> | undefined | null) => {
  if (!env) return undefined;
  const value = env.AuthDatabase ?? env.AUTH_DB;
  return isD1Database(value) ? value : undefined;
};
