import { InventoryHyperdrive } from "@store/db/postgres/infra";
import * as Cloudflare from "alchemy/Cloudflare";
import * as DrizzlePostgres from "alchemy/Drizzle/Postgres";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";

export type InventoryDrizzle = EffectPgDatabase;

export const openInventoryDrizzle = Effect.gen(function* () {
  const inventoryHyperdrive = yield* InventoryHyperdrive;
  const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(inventoryHyperdrive);
  return yield* DrizzlePostgres.Postgres(hyperdrive.connectionString).pipe(Effect.orDie);
});
