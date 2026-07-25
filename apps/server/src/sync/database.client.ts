import { durableObjectRelations } from "@store/db/do/relations";
import * as DoDrizzle from "drizzle-orm/effect-sqlite-do";
import type * as Effect from "effect/Effect";

/**
 * `storage` is required, not optional: the drizzle types note that transactions
 * are silently broken without it, because the `@effect/sql-sqlite-do` wrapper
 * cannot open one from the `SqlStorage` handle alone. Every sync exchange runs
 * in a transaction, so this is load-bearing.
 */
export const makeSyncDrizzle = (storage: DurableObjectStorage) =>
  DoDrizzle.makeWithDefaults({ relations: durableObjectRelations, storage });

export type SyncDrizzle = Effect.Success<ReturnType<typeof makeSyncDrizzle>>;
export type SyncTransaction = Parameters<Parameters<SyncDrizzle["transaction"]>[0]>[0];
