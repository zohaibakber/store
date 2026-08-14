import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";

/**
 * Global identity store: legacy Better Auth users/orgs (kept so existing
 * Durable Object names can be recovered by email) plus `clerk_org_binding`.
 * Inventory and sync logs still live in each organization's Durable Object.
 *
 * `Drizzle.Schema` regenerates pending migration SQL from `schema.ts` on every
 * deploy and `migrationsDir` applies it, so the database can never lag the
 * Worker that queries it. Both resources move together on a schema change,
 * which is why they share a file.
 */
export const AuthDatabase = Effect.gen(function* () {
  const schema = yield* Drizzle.Schema("AuthSchema", {
    schema: new URL("./schema.ts", import.meta.url).pathname,
    out: new URL("../../migrations/auth", import.meta.url).pathname,
    dialect: "sqlite",
  });

  return yield* Cloudflare.D1.Database("AuthDatabase", {
    migrationsDir: schema.out,
    // drizzle-kit's own tracking table name, so a migration applied by
    // `drizzle-kit migrate` and one applied by a deploy are the same row.
    migrationsTable: "drizzle_migrations",
  });
});
