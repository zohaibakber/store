import { migrate } from "drizzle-orm/effect-libsql/migrator";
import * as Layer from "effect/Layer";

import type { PersistenceConfig } from "./config";
import { MIGRATIONS_TABLE } from "./database/client";
import { nodeClientLayer } from "./database/node-client";
import { mapPersistenceError } from "./errors";
import { storeLayer } from "./service";

export type { PersistenceConfig, SyncTransport, Workspace } from "./config";
export { AuthenticatedWorkspace } from "./config";
export {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  SyncTransportError,
} from "./errors";
export { OfflineStore, storeLayer } from "./service";

export const layer = (config: PersistenceConfig) =>
  storeLayer({
    ...config,
    applySchema:
      config.applySchema ??
      (config.migrationsFolder
        ? (database) =>
            migrate(database, {
              migrationsFolder: config.migrationsFolder!,
              migrationsTable: MIGRATIONS_TABLE,
            }).pipe(mapPersistenceError("migrate database"))
        : undefined),
  }).pipe(Layer.provide(nodeClientLayer(config)));
