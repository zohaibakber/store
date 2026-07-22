import { remoteRelations } from "@store/db/remote/relations";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type * as Effect from "effect/Effect";

export const makeSyncDrizzle = () => PgDrizzle.makeWithDefaults({ relations: remoteRelations });

export type SyncDrizzle = Effect.Success<ReturnType<typeof makeSyncDrizzle>>;
export type SyncTransaction = Parameters<Parameters<SyncDrizzle["transaction"]>[0]>[0];
