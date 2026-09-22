import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Planetscale from "alchemy/Planetscale";
import * as Effect from "effect/Effect";

export { stageUsesInventoryPostgres } from "./stage";

/**
 * Authoritative inventory database.
 *
 * Alchemy applies the reviewed Drizzle migrations. The Worker does not.
 */
export const InventoryPostgres = Effect.gen(function* () {
  const schema = yield* Drizzle.Schema("InventoryPostgresSchema", {
    schema: "packages/db/src/postgres/schema.ts",
    out: "packages/db/migrations/postgres",
    dialect: "postgres",
  });

  return yield* Planetscale.PostgresDatabase("InventoryPostgres", {
    clusterSize: "PS_10",
    migrations: schema,
  });
});

/**
 * Role the Worker uses to connect.
 *
 * This is not the branch default role. Alchemy migrates with the database
 * resource; Hyperdrive uses this role's direct origin.
 */
export const InventoryPostgresRole = Effect.gen(function* () {
  const database = yield* InventoryPostgres;
  return yield* Planetscale.PostgresRole("InventoryPostgresRole", {
    database,
    inheritedRoles: ["postgres"],
  });
});

export const InventoryHyperdrive = Effect.gen(function* () {
  const role = yield* InventoryPostgresRole;
  return yield* Cloudflare.Hyperdrive.Connection("InventoryPostgresHyperdrive", {
    origin: role.origin,
    dev: {
      scheme: role.pooledOrigin.scheme,
      host: role.pooledOrigin.host,
      port: role.pooledOrigin.port,
      database: role.pooledOrigin.database,
      user: role.pooledOrigin.user,
      password: role.pooledOrigin.password,
      sslmode: "require",
    },
    caching: { disabled: true },
  });
});
