import { getConnectionURI } from "@distilled.cloud/neon";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as AlchemyOutput from "alchemy/Output";
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

/**
 * `Neon.Project` copies its create-time connection URI across updates, so
 * Hyperdrive must not use `postgres.origin`. Ask Neon for the current URI at
 * deploy time. The Worker runtime resolves the already-bound Hyperdrive and
 * must not call the Neon API.
 */
const currentInventoryOrigin = (postgres: Neon.Project) =>
  Effect.gen(function* () {
    const projectId = yield* yield* postgres.projectId;
    const branchId = yield* yield* postgres.defaultBranchId;
    const databaseName = yield* yield* postgres.databaseName;
    const roleName = yield* yield* postgres.roleName;
    const direct = yield* getConnectionURI({
      project_id: projectId,
      branch_id: branchId,
      database_name: databaseName,
      role_name: roleName,
      pooled: false,
    });
    const pooled = yield* getConnectionURI({
      project_id: projectId,
      branch_id: branchId,
      database_name: databaseName,
      role_name: roleName,
      pooled: true,
    });
    return {
      origin: Neon.parsePostgresOrigin(direct.uri),
      pooledOrigin: Neon.parsePostgresOrigin(pooled.uri),
    };
  });

/** Cloudflare's pooled Worker connection to the authoritative inventory DB. */
export const InventoryHyperdrive = Effect.gen(function* () {
  const postgres = yield* InventoryPostgres;
  // Folded to the cached origin in the Worker bundle. `fromEffect` keeps the
  // Neon lookup out of the stack program's requirements.
  const credentials = !globalThis.__ALCHEMY_RUNTIME__
    ? AlchemyOutput.fromEffect(currentInventoryOrigin(postgres).pipe(Effect.orDie))
    : { origin: postgres.origin, pooledOrigin: postgres.pooledOrigin };
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
