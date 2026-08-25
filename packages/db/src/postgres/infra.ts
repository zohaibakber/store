import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Effect from "effect/Effect";

import { InventoryRolePassword, inventoryRolePasswordVersion } from "./role-password";

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
  const { stage } = yield* Alchemy.Stack;
  const credentials = yield* InventoryRolePassword("InventoryRolePassword", {
    projectId: postgres.projectId,
    branchId: postgres.defaultBranchId,
    roleName: postgres.roleName,
    databaseName: postgres.databaseName,
    version: inventoryRolePasswordVersion(stage),
  });
  return yield* Cloudflare.Hyperdrive.Connection("InventoryPostgresHyperdrive", {
    // Hyperdrive is itself a pooler, so its production origin is Neon's direct endpoint.
    origin: credentials.origin,
    // Local workerd bypasses Hyperdrive and should use Neon's pooled endpoint.
    dev: {
      scheme: credentials.pooledOrigin.scheme,
      host: credentials.pooledOrigin.host,
      port: credentials.pooledOrigin.port,
      database: credentials.pooledOrigin.database,
      user: credentials.pooledOrigin.user,
      password: credentials.pooledOrigin.password,
      sslmode: "require",
    },
    // Writes must never be served from Hyperdrive's query cache.
    caching: { disabled: true },
  });
});
