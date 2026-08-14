/**
 * Hono bound Better Auth's D1 as `c.env.AUTH_DB` on the fetch handler's env.
 * Effect HTTP moved that to Alchemy's QueryDatabase, whose LogicalId is
 * `AuthDatabase`. Production 500s every `/api/auth/*` when the adapter sees
 * neither — Better Auth then throws "Failed to initialize database adapter".
 *
 * Accept both names, and only treat a value as D1 if it has the methods the
 * Kysely D1 dialect actually calls.
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
