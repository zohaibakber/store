import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Planetscale from "alchemy/Planetscale";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

import { stageUsesNeonInventory } from "./stage";

export {
  stageUsesInventoryPostgres,
  stageUsesNeonInventory,
  stageUsesPlanetscaleInventory,
} from "./stage";

const InventorySchema = Drizzle.Schema("InventoryPostgresSchema", {
  schema: "packages/db/src/postgres/schema.ts",
  out: "packages/db/migrations/postgres",
  dialect: "postgres",
});

/**
 * Authoritative inventory database on PlanetScale.
 *
 * Alchemy applies the reviewed Drizzle migrations. The Worker does not.
 * The database is retained: replacing or removing the resource never
 * deletes the physical database.
 */
export const InventoryPostgres = Effect.gen(function* () {
  const schema = yield* InventorySchema;
  return yield* Planetscale.PostgresDatabase("InventoryPostgres", {
    clusterSize: "PS_10",
    migrations: schema,
  }).pipe(RemovalPolicy.retain());
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

/**
 * Development inventory database on Neon. Alchemy applies the same Drizzle
 * migrations as production.
 */
export const InventoryNeon = Effect.gen(function* () {
  const schema = yield* InventorySchema;
  return yield* Neon.Project("InventoryNeon", {
    name: "tabaaq-inventory-dev",
    migrations: schema,
  });
});

const hyperdriveOptions = { caching: { disabled: true } } as const;

export const InventoryHyperdrive = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (stageUsesNeonInventory(stage)) {
    const project = yield* InventoryNeon;
    return yield* Cloudflare.Hyperdrive.Connection("InventoryPostgresHyperdrive", {
      ...hyperdriveOptions,
      origin: project.origin,
      dev: {
        scheme: project.pooledOrigin.scheme,
        host: project.pooledOrigin.host,
        port: project.pooledOrigin.port,
        database: project.pooledOrigin.database,
        user: project.pooledOrigin.user,
        password: project.pooledOrigin.password,
        sslmode: "require",
      },
    });
  }
  const role = yield* InventoryPostgresRole;
  return yield* Cloudflare.Hyperdrive.Connection("InventoryPostgresHyperdrive", {
    ...hyperdriveOptions,
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
  });
});

export const InventoryDatabaseId = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (stageUsesNeonInventory(stage)) {
    const project = yield* InventoryNeon;
    return project.projectId;
  }
  const database = yield* InventoryPostgres;
  return database.id;
});
