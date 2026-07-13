import * as PgClient from "@effect/sql-pg/PgClient";
import type { SyncRequest } from "@store/contracts";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import { syncDatabaseLayer } from "./database";
import { syncProgram, syncServiceLayer, type SyncActor } from "./service";

export const makeSyncRuntime = (connectionString: string) => {
  const postgresLayer = PgClient.layer({
    url: Redacted.make(connectionString),
    maxConnections: 1,
    applicationName: "store-sync-worker",
  });
  const databaseLayer = syncDatabaseLayer.pipe(Layer.provide(postgresLayer));
  const liveLayer = syncServiceLayer.pipe(Layer.provide(databaseLayer));
  const runtime = ManagedRuntime.make(liveLayer);

  return {
    runSync: (actor: SyncActor, request: SyncRequest) =>
      runtime.runPromise(syncProgram(actor, request)),
    dispose: () => runtime.dispose(),
  };
};
