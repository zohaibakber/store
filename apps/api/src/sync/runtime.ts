import * as PgClient from "@effect/sql-pg/PgClient";
import type { SyncRequest } from "@store/contracts";
import * as Config from "effect/Config";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { syncDatabaseLayer } from "./database";
import { syncProgram, syncServiceLayer, type SyncActor } from "./service";

const postgresLayer = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(5),
  applicationName: Config.succeed("store-sync-api"),
});

const databaseLayer = syncDatabaseLayer.pipe(Layer.provide(postgresLayer));
const liveLayer = syncServiceLayer.pipe(Layer.provide(databaseLayer));
const runtime = ManagedRuntime.make(liveLayer);

export const runSync = (actor: SyncActor, request: SyncRequest) =>
  runtime.runPromise(syncProgram(actor, request));
