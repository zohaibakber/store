import { durableObjectRelations } from "@store/db/do/relations";
import * as DoDrizzle from "drizzle-orm/effect-sqlite-do";
import type * as Effect from "effect/Effect";

// Omitting storage silently disables transactions.
export const makeSyncDrizzle = (storage: DurableObjectStorage) =>
  DoDrizzle.makeWithDefaults({ relations: durableObjectRelations, storage });

export type SyncDrizzle = Effect.Success<ReturnType<typeof makeSyncDrizzle>>;
export type SyncTransaction = Parameters<Parameters<SyncDrizzle["transaction"]>[0]>[0];
