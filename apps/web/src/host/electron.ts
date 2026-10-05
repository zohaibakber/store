import type {
  GlobalProductSearchInput,
  GlobalProductSearchResult,
  InvoiceExtraction,
} from "@store/contracts/server-api.schema";
import * as Schema from "effect/Schema";

import type { AppHost, AppUpdaterBridge, DesktopShellBridge, ThemeBridge } from "./index";
import type { InvoiceUploadFile } from "./invoice-upload";
import { remoteFailureMessage } from "./remote-failure";
import { decodedShareBridge, type ShareBridge } from "./share";
import { decodedBackupBridge, type WorkspaceBackupBridge } from "./workspace-backup";

export type ServerApiIpcBridge = {
  readonly analyseInvoices: (input: {
    files: Array<InvoiceUploadFile>;
  }) => Promise<InvoiceExtraction>;
  readonly searchGlobalProducts: (
    input: GlobalProductSearchInput,
  ) => Promise<GlobalProductSearchResult>;
};

export const InventoryHttpConfig = Schema.Struct({
  apiBaseUrl: Schema.String,
  deviceId: Schema.String,
});
export type InventoryHttpConfig = typeof InventoryHttpConfig.Type;

export interface InventoryHttpBridge {
  readonly getConfig: () => Promise<InventoryHttpConfig>;
}

export type ReplicaWorkspaceBridge = {
  readonly open: () => Promise<{
    readonly workspaceToken: string;
    readonly engine: "sqlite" | "unavailable";
  }>;
  readonly close: (workspaceToken: string) => Promise<void>;
  readonly retryRecovery: (workspaceToken: string) => Promise<void>;
};

declare global {
  interface Window {
    inventoryHttp?: InventoryHttpBridge;
    replica?: ReplicaWorkspaceBridge;
    workspaceBackup?: WorkspaceBackupBridge;
    sharing?: ShareBridge;
    electronTheme?: ThemeBridge;
    desktopShell?: DesktopShellBridge;
    serverApi?: ServerApiIpcBridge;
    updater?: AppUpdaterBridge;
  }
}

const withServerMessage = <A>(reply: Promise<A>): Promise<A> =>
  reply.catch((cause: unknown) => {
    throw cause instanceof Error
      ? new Error(remoteFailureMessage(cause.message), { cause })
      : cause;
  });

type PreloadBridges = Pick<
  Window,
  "serverApi" | "desktopShell" | "updater" | "electronTheme" | "workspaceBackup" | "sharing"
>;

export const electronAppHost = (bridges: PreloadBridges): AppHost => {
  const { serverApi, sharing, desktopShell, electronTheme, workspaceBackup } = bridges;
  if (!serverApi) throw new Error("Desktop server bridge is unavailable.");
  if (!sharing) throw new Error("Desktop sharing bridge is unavailable.");
  if (!desktopShell || !electronTheme) throw new Error("Desktop shell bridge is unavailable.");
  if (!workspaceBackup) throw new Error("Desktop workspace bridge is unavailable.");
  return {
    ...decodedShareBridge(sharing),
    analyseInvoices: (files) => serverApi.analyseInvoices({ files: [...files] }),
    searchGlobalProducts: (query) => withServerMessage(serverApi.searchGlobalProducts({ query })),
    shell: desktopShell,
    updater: bridges.updater,
    theme: electronTheme,
    backup: decodedBackupBridge(workspaceBackup),
  };
};
