import * as Layer from "effect/Layer";

import type { PersistenceConfig } from "./config";
import { browserClientLayer } from "./database/browser-client";
import { storeLayer } from "./service";

export { AuthenticatedWorkspace } from "./config";
export type { PersistenceConfig, SyncTransport, Workspace } from "./config";
export {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  SyncTransportError,
} from "./errors";
export { OfflineStore } from "./service";
export type { LiveSocketHandle, SyncSocket, SyncSocketSession } from "./sync/session";
export { makeSyncSocketSession, syncSocketFromHandle } from "./sync/session";

export const browserLayer = (config: PersistenceConfig) =>
  storeLayer(config).pipe(Layer.provide(browserClientLayer(config)));
