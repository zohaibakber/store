import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";

/**
 * Where the deploy regenerates this database's migration SQL from `schema.ts`.
 *
 * Both paths are filesystem locations derived from `import.meta.url`, and a
 * deployed Worker has neither: workerd leaves `import.meta.url` `undefined`, so
 * `new URL("./schema.ts", undefined)` throws `TypeError: Invalid URL string.`
 * there. That matters because `AuthDatabase` is not deploy-only code — the
 * Worker yields it on every request to find its D1 binding — so computing the
 * paths unconditionally failed the Worker before it could serve anything, and
 * every `/api/auth/*` request answered 500.
 *
 * The bundler folds `globalThis.__ALCHEMY_RUNTIME__` to `true` in the deployed
 * artifact, which drops this branch and drizzle-kit along with it. Nothing reads
 * `migrationsDir` at runtime: migrations are applied by the deploy.
 */
const AuthMigrationsDir = Effect.gen(function* () {
  if (globalThis.__ALCHEMY_RUNTIME__) return undefined;

  const schema = yield* Drizzle.Schema("AuthSchema", {
    schema: new URL("./schema.ts", import.meta.url).pathname,
    out: new URL("../../migrations/auth", import.meta.url).pathname,
    dialect: "sqlite",
  });
  return schema.out;
});

/**
 * Better Auth's global identity store: users, sessions, organizations, and
 * memberships. Only what needs a global lookup lives here — each organization's
 * inventory and sync log live in its own Durable Object's SQLite instead.
 *
 * {@link AuthMigrationsDir} regenerates pending migration SQL from `schema.ts`
 * on every deploy and `migrationsDir` applies it, so the database can never lag
 * the Worker that queries it. Both resources move together on a schema change,
 * which is why they share a file.
 */
export const AuthDatabase = Effect.gen(function* () {
  const migrationsDir = yield* AuthMigrationsDir;

  return yield* Cloudflare.D1.Database("AuthDatabase", {
    migrationsDir,
    // drizzle-kit's own tracking table name, so a migration applied by
    // `drizzle-kit migrate` and one applied by a deploy are the same row.
    migrationsTable: "drizzle_migrations",
  });
});
