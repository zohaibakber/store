/**
 * Hono bound Better Auth's D1 as `c.env.AUTH_DB` on the fetch handler's env.
 * Effect HTTP moved that to Alchemy's QueryDatabase, whose LogicalId is
 * `AuthDatabase`. Production 500s every `/api/auth/*` when the adapter sees
 * neither — Better Auth then throws "Failed to initialize database adapter".
 *
 * Accept both names, scan every enumerable binding if those are missing, and
 * only treat a value as D1 if it has the methods the Kysely D1 dialect calls.
 */
export const D1_BINDING_NAMES = ["AuthDatabase", "AUTH_DB"] as const;

export const isD1Database = (value: unknown): value is D1Database =>
  typeof value === "object" &&
  value !== null &&
  "prepare" in value &&
  "batch" in value &&
  "exec" in value &&
  typeof (value as D1Database).prepare === "function";

const readBinding = (env: object, key: string): unknown => {
  try {
    return (env as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

/** Shallow copy of a Worker env, including known D1 names even if absent. */
export const envSnapshot = (env: unknown): Record<string, unknown> => {
  if (typeof env !== "object" || env === null) return {};
  const keys = new Set<string>([...Object.keys(env), ...Object.getOwnPropertyNames(env), ...D1_BINDING_NAMES]);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    snapshot[key] = readBinding(env, key);
  }
  return snapshot;
};

export const mergeEnvSnapshots = (...envs: ReadonlyArray<unknown>): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const env of envs) Object.assign(merged, envSnapshot(env));
  return merged;
};

export const describeEnv = (env: Record<string, unknown> | undefined | null) => {
  const snapshot = envSnapshot(env);
  const keys = Object.keys(snapshot).sort();
  const describe = (value: unknown) => {
    if (value === undefined) return "missing";
    if (isD1Database(value)) return "d1";
    if (value === null) return "null";
    return typeof value;
  };
  return {
    keys,
    d1: d1FromEnv(snapshot) !== undefined,
    AuthDatabase: describe(snapshot.AuthDatabase),
    AUTH_DB: describe(snapshot.AUTH_DB),
  };
};

export const d1FromEnv = (env: Record<string, unknown> | undefined | null) => {
  if (!env) return undefined;
  for (const name of D1_BINDING_NAMES) {
    const named = env[name];
    if (isD1Database(named)) return named;
  }
  for (const value of Object.values(env)) {
    if (isD1Database(value)) return value;
  }
  return undefined;
};
