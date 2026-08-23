import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Effect from "effect/Effect";

/** The authoritative inventory database. */
export const InventoryPostgres = Effect.gen(function* () {
  const schema = yield* Drizzle.Schema("InventoryPostgresSchema", {
    schema: "packages/db/src/postgres/schema.ts",
    out: "packages/db/migrations/postgres",
    dialect: "postgres",
  });

  return yield* Neon.Project("InventoryPostgres", {
    enableLogicalReplication: true,
    migrations: schema,
  });
});

/** Cloudflare's pooled Worker connection to the authoritative inventory DB. */
export const InventoryHyperdrive = Effect.gen(function* () {
  const postgres = yield* InventoryPostgres;
  return yield* Cloudflare.Hyperdrive.Connection("InventoryPostgresHyperdrive", {
    // Hyperdrive is itself a pooler, so its production origin is Neon's direct endpoint.
    origin: postgres.origin,
    // Local workerd bypasses Hyperdrive and should use Neon's pooled endpoint.
    dev: {
      scheme: postgres.pooledOrigin.scheme,
      host: postgres.pooledOrigin.host,
      port: postgres.pooledOrigin.port,
      database: postgres.pooledOrigin.database,
      user: postgres.pooledOrigin.user,
      password: postgres.pooledOrigin.password,
      sslmode: "require",
    },
    // Writes must never be served from Hyperdrive's query cache.
    caching: { disabled: true },
  });
});
