export { AuthenticatedWorkspace } from "./config";
export type { PersistenceConfig, SyncTransport, Workspace } from "./config";
export {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  SyncTransportError,
} from "./errors";
export { OfflineStore, storeLayer } from "./service";
export type { LiveSocketHandle, SyncSocket, SyncSocketSession } from "./sync/session";
export { makeSyncSocketSession, syncSocketFromHandle } from "./sync/session";
