import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";

/**
 * Better Auth's global identity store: users, sessions, organizations, and
 * memberships. Only what needs a global lookup lives here — each organization's
 * inventory and sync log live in its own Durable Object's SQLite instead.
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
