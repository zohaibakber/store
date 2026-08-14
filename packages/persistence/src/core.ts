export type { PersistenceConfig, SyncTransport, Workspace } from "./config";
export { AuthenticatedWorkspace } from "./config";
export {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  SyncTransportError,
} from "./errors";
export { OfflineStore, storeLayer } from "./service";
