import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";

/**
 * First-party identity, credentials, organizations, memberships, and refresh
 * sessions.
 *
 * Wired the way Alchemy documents for D1 + Drizzle (`alchemy.run/cloudflare/data/d1-drizzle`):
 * `Drizzle.Schema` regenerates pending SQL from `schema.ts` on every deploy, and
 * `migrationsDir` applies it. Both resources move together on a schema change,
 * which is why they share a file.
 *
 * Paths are relative to the process working directory, the repo root where
 * `alchemy.run.ts` lives.
 */
export const AuthDatabase = Effect.gen(function* () {
  const schema = yield* Drizzle.Schema("AuthSchema", {
    schema: "packages/db/src/auth/schema.ts",
    out: "packages/db/migrations/auth",
    dialect: "sqlite",
  });

  return yield* Cloudflare.D1.Database("AuthDatabase", {
    migrationsDir: schema.out,
    // drizzle-kit's own tracking table name, so a migration applied by
    // `drizzle-kit migrate` and one applied by a deploy are the same row.
    migrationsTable: "drizzle_migrations",
  });
});
