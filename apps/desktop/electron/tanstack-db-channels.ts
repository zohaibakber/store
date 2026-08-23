import type { ElectronSQLitePersistenceOptions } from "@tanstack/electron-db-sqlite-persistence";

export const TANSTACK_DB_PERSISTENCE_CHANNEL = "tanstack-db:sqlite-persistence";

type ElectronPersistenceInvoke = NonNullable<ElectronSQLitePersistenceOptions["invoke"]>;
type TanStackDbPersistenceRequest = Parameters<ElectronPersistenceInvoke>[1];
type TanStackDbPersistenceResponse = Awaited<ReturnType<ElectronPersistenceInvoke>>;

export interface TanStackDbPersistenceBridge {
  readonly invoke: (
    request: TanStackDbPersistenceRequest,
  ) => Promise<TanStackDbPersistenceResponse>;
}
