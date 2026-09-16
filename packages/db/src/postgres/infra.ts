import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Planetscale from "alchemy/Planetscale";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

/** Existing PlanetScale cluster `tabaaq/db`. Adopt it; do not create another. */
const INVENTORY_DATABASE_NAME = "db";

const inventoryCluster = {
  clusterSize: "PS_5",
  arch: "arm",
  replicas: 0,
  region: { slug: "us-east" },
} as const;

/** The authoritative inventory database. */
export const InventoryPostgres = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("InventoryPostgresSchema", {
    schema: "packages/db/src/postgres/schema.ts",
    out: "packages/db/migrations/postgres",
    dialect: "postgres",
  });

  // Retain: live stages adopt this billed cluster. Destroying one stage must
  // not drop production data.
  const database = yield* Planetscale.PostgresDatabase("InventoryPostgres", {
    name: INVENTORY_DATABASE_NAME,
    ...inventoryCluster,
    ...(stage === "prod" ? { migrations: schema } : {}),
  }).pipe(adopt(), RemovalPolicy.retain());

  const branch =
    stage === "prod"
      ? undefined
      : yield* Planetscale.PostgresBranch("InventoryPostgresBranch", {
          name: stage,
          database,
          parentBranch: "main",
          clusterSize: inventoryCluster.clusterSize,
          replicas: inventoryCluster.replicas,
          migrations: schema,
        }).pipe(adopt());

  return { database, branch };
});

/** Cloudflare's pooled Worker connection to the authoritative inventory DB. */
export const InventoryHyperdrive = Effect.gen(function* () {
  const { database, branch } = yield* InventoryPostgres;
  const role = yield* Planetscale.PostgresRole("InventoryPostgresAppRole", {
    database,
    branch: branch ?? "main",
    inheritedRoles: ["pg_read_all_data", "pg_write_all_data"],
  });
  return yield* Cloudflare.Hyperdrive.Connection("InventoryPostgresHyperdrive", {
    // Hyperdrive is itself a pooler, so its production origin is the direct endpoint.
    origin: role.origin,
    // Local workerd bypasses Hyperdrive and should use PlanetScale's pooled endpoint.
    dev: {
      scheme: role.pooledOrigin.scheme,
      host: role.pooledOrigin.host,
      port: role.pooledOrigin.port,
      database: role.pooledOrigin.database,
      user: role.pooledOrigin.user,
      password: role.pooledOrigin.password,
      sslmode: "require",
    },
    // Writes must never be served from Hyperdrive's query cache.
    caching: { disabled: true },
    // PS_5 has a small connection budget; leave room for PowerSync and migrations.
    originConnectionLimit: 10,
  });
});
