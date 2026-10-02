import type {
  IdentifyInput,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { ElectronReplicaBridge } from "@store/client-db";
import type { WorkspaceSnapshot } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";

import type {
  AppHost,
  AppUpdaterBridge,
  DesktopShellBridge,
  SignInCredentials,
  ThemeBridge,
} from "./index";
import { controlNewSaleShortcut } from "./new-sale-shortcut";
import { remoteFailureMessage } from "./remote-failure";
import { decodedShareBridge, type ShareBridge } from "./share";
import { decodedBackupBridge, type WorkspaceBackupBridge } from "./workspace-backup";
import { decodedPublishBridge, type WorkspacePublishBridge } from "./workspace-publish";

export type AuthIpcBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly identify: (input: IdentifyInput) => Promise<LoginRoute>;
  readonly authenticate: (credentials: SignInCredentials) => Promise<WorkspaceSnapshot>;
  readonly beginGoogle: () => Promise<void>;
  readonly completeGoogle: (callbackUrl: string) => Promise<WorkspaceSnapshot | null>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  readonly onOAuthCallback: (callback: (url: string) => void) => () => void;
  readonly onSessionChange: (callback: (snapshot: WorkspaceSnapshot) => void) => () => void;
};

export type ServerApiIpcBridge = {
  readonly analyseInvoices: (input: {
    files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
  }) => Promise<InvoiceExtraction>;
};

export interface InventoryHttpConfig {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
}

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
    newSaleShortcut: controlNewSaleShortcut,
    shell: bridges.desktopShell,
    updater: bridges.updater,
    theme: bridges.electronTheme,
    backup: bridges.workspaceBackup && decodedBackupBridge(bridges.workspaceBackup),
    publish: bridges.workspacePublish && decodedPublishBridge(bridges.workspacePublish),
  };
};
