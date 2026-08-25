import { getConnectionURI, resetProjectBranchRolePassword } from "@distilled.cloud/neon";
import * as Alchemy from "alchemy";
import * as Neon from "alchemy/Neon";
import * as Provider from "alchemy/Provider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Pooled hostname from the Development PowerSync config. The committed
 * Postgres URI used this host; bump {@link inventoryRolePasswordVersion}
 * only after confirming Alchemy's `dev` project still points here.
 */
const LEAKED_DEV_POOLED_HOST = "ep-mute-dew-afrz2glu-pooler.c-2.us-west-2.aws.neon.tech";

/**
 * Bump the returned number for a stage to reset that stage's Neon role
 * password on the next `alchemy deploy`. `0` refreshes Hyperdrive from
 * Neon's current URI without resetting.
 *
 * Development is 1 so the next deploy invalidates the leaked URI.
 * Production stays 0 until an operator explicitly bumps it.
 */
export const inventoryRolePasswordVersion = (stage: string) => (stage === "dev" ? 1 : 0);

const hostnameOf = (uri: string) => new URL(uri).hostname;

const resolveConnection = (
  projectId: string,
  branchId: string,
  databaseName: string,
  roleName: string,
) =>
  Effect.gen(function* () {
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
      connectionUri: direct.uri,
      pooledConnectionUri: pooled.uri,
      origin: Neon.parsePostgresOrigin(direct.uri),
      pooledOrigin: Neon.parsePostgresOrigin(pooled.uri),
    };
  });

export class InventoryRolePasswordProviders extends Provider.ProviderCollection<InventoryRolePasswordProviders>()(
  "StoreNeon",
) {}

type InventoryRolePasswordProps = {
  projectId: string;
  branchId: string;
  roleName: string;
  databaseName: string;
  version: number;
};

type InventoryRolePasswordAttributes = {
  version: number;
  reset: boolean;
  connectionUri: string;
  pooledConnectionUri: string;
  origin: Neon.PostgresOrigin;
  pooledOrigin: Neon.PostgresOrigin;
};

export type InventoryRolePassword = Alchemy.Resource<
  "Store.NeonRolePassword",
  InventoryRolePasswordProps,
  InventoryRolePasswordAttributes,
  never,
  InventoryRolePasswordProviders
>;

/**
 * Fetches (and optionally resets) the inventory role password so Hyperdrive
 * does not keep the URI `Neon.Project` cached at create time.
 *
 * Neon.Project's update path copies `output.connectionUri` forward and never
 * calls `getConnectionURI` again, so a leaked password stays in Alchemy
 * state and Hyperdrive across ordinary deploys.
 */
export const InventoryRolePassword =
  Alchemy.Resource<InventoryRolePassword>("Store.NeonRolePassword");

export const InventoryRolePasswordProvider = () =>
  Provider.succeed(InventoryRolePassword, {
    diff: Effect.fn(function* ({ news, output }) {
      if (!Alchemy.isResolved(news)) return undefined;
      if (news.version !== (output?.version ?? -1)) {
        return { action: "update" } as const;
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      return output;
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      if (output && output.version === news.version) {
        return output;
      }

      const current = yield* resolveConnection(
        news.projectId,
        news.branchId,
        news.databaseName,
        news.roleName,
      );
      const pooledHost = hostnameOf(current.pooledConnectionUri);

      if (news.version < 1) {
        return { ...current, version: news.version, reset: false };
      }

      if (pooledHost !== LEAKED_DEV_POOLED_HOST) {
        return yield* Effect.fail(
          new Error(
            `Refusing to reset the Neon role password: pooled host ${pooledHost} is not the leaked Development endpoint.`,
          ),
        );
      }

      const reset = yield* resetProjectBranchRolePassword({
        project_id: news.projectId,
        branch_id: news.branchId,
        role_name: news.roleName,
      });
      yield* Neon.waitForOperations(reset.operations);
      const rotated = yield* resolveConnection(
        news.projectId,
        news.branchId,
        news.databaseName,
        news.roleName,
      );
      yield* Console.log(
        `Reset Neon role ${news.roleName} on ${hostnameOf(rotated.pooledConnectionUri)} (version ${news.version}).`,
      );
      return { ...rotated, version: news.version, reset: true };
    }),
    delete: Effect.fn(function* () {
      // The Postgres role outlives this resource. Destroying the stack must
      // not drop neondb_owner.
    }),
  });

export const inventoryRolePasswordProviders = () =>
  Layer.effect(InventoryRolePasswordProviders, Provider.collection([InventoryRolePassword])).pipe(
    Layer.provide(InventoryRolePasswordProvider()),
  );
