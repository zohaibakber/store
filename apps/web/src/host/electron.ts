import type { ElectronReplicaBridge } from "@store/client-db";
import type { DeviceCommand, OrganizationDevices } from "@store/contracts";
import type {
  GlobalProductSearchInput,
  GlobalProductSearchResult,
  InvoiceExtraction,
} from "@store/contracts/server-api.schema";
import * as Schema from "effect/Schema";

import type {
  AppHost,
  AppUpdaterBridge,
  AuthSessionBridge,
  DesktopShellBridge,
  SignInBridge,
  ThemeBridge,
} from "./index";
import type { InvoiceUploadFile } from "./invoice-upload";
import { controlNewSaleShortcut } from "./new-sale-shortcut";
import { remoteFailureMessage } from "./remote-failure";
import { decodedShareBridge, type ShareBridge } from "./share";
import { decodedBackupBridge, type WorkspaceBackupBridge } from "./workspace-backup";
import { decodedPublishBridge, type WorkspacePublishBridge } from "./workspace-publish";

export type AuthIpcBridge = AuthSessionBridge & Omit<SignInBridge, "hasPendingOAuthCallback">;

export type ServerApiIpcBridge = {
  readonly analyseInvoices: (input: {
    files: Array<InvoiceUploadFile>;
  }) => Promise<InvoiceExtraction>;
  readonly searchGlobalProducts: (
    input: GlobalProductSearchInput,
  ) => Promise<GlobalProductSearchResult>;
  readonly organizationDevices: () => Promise<OrganizationDevices>;
  readonly commandDevice: (command: DeviceCommand) => Promise<OrganizationDevices>;
};

export const InventoryHttpConfig = Schema.Struct({
  apiBaseUrl: Schema.String,
  deviceId: Schema.String,
});
export type InventoryHttpConfig = typeof InventoryHttpConfig.Type;

export interface InventoryHttpBridge {
  readonly getConfig: () => Promise<InventoryHttpConfig>;
}

declare global {
  interface Window {
    inventoryHttp?: InventoryHttpBridge;
    replica?: ElectronReplicaBridge;
    workspaceBackup?: WorkspaceBackupBridge;
    sharing?: ShareBridge;
    workspacePublish?: WorkspacePublishBridge;
    electronTheme?: ThemeBridge;
    desktopShell?: DesktopShellBridge;
    auth?: AuthIpcBridge;
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
  | "auth"
  | "serverApi"
  | "desktopShell"
  | "updater"
  | "electronTheme"
  | "workspaceBackup"
  | "sharing"
  | "workspacePublish"
>;

export const electronAppHost = (bridges: PreloadBridges): AppHost => {
  const { auth, serverApi, sharing } = bridges;
  if (!auth || !serverApi) throw new Error("Desktop authentication bridge is unavailable.");
  if (!sharing) throw new Error("Desktop sharing bridge is unavailable.");
  return {
    ...decodedShareBridge(sharing),
    auth,
    signIn: {
      identify: (input) => withServerMessage(auth.identify(input)),
      authenticate: (credentials) => withServerMessage(auth.authenticate(credentials)),
      beginGoogle: () => withServerMessage(auth.beginGoogle()),
      completeGoogle: (callbackUrl) => withServerMessage(auth.completeGoogle(callbackUrl)),
      onOAuthCallback: (listener) => auth.onOAuthCallback(listener),
    },
    analyseInvoices: (files) => serverApi.analyseInvoices({ files: [...files] }),
    searchGlobalProducts: (query) => withServerMessage(serverApi.searchGlobalProducts({ query })),
    devices: {
      list: () => withServerMessage(serverApi.organizationDevices()),
      command: (command) => withServerMessage(serverApi.commandDevice(command)),
    },
    newSaleShortcut: controlNewSaleShortcut,
    shell: bridges.desktopShell,
    updater: bridges.updater,
    theme: bridges.electronTheme,
    backup: bridges.workspaceBackup && decodedBackupBridge(bridges.workspaceBackup),
    publish: bridges.workspacePublish && decodedPublishBridge(bridges.workspacePublish),
  };
};
