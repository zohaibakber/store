import type {
  IssuedSession,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";

import type { WorkspaceBackupIpcBridge } from "./backup-channels";
import type { InventoryHttpBridge } from "./inventory-http-channels";
import type { WorkspacePublishIpcBridge } from "./publish-channels";
import type { ReplicaIpcBridge } from "./replica-channels";
import type { ShareIpcBridge } from "./share-channels";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
      VITE_SENTRY_DSN?: string;
    }
  }

  interface Window {
    inventoryHttp?: InventoryHttpBridge;
    replica?: ReplicaIpcBridge;
    workspaceBackup?: WorkspaceBackupIpcBridge;
    sharing?: ShareIpcBridge;
    workspacePublish?: WorkspacePublishIpcBridge;
    electronTheme?: {
      setSource: (source: "dark" | "light" | "system") => void;
    };
    desktopShell?: {
      onNewSale: (callback: () => void) => () => void;
    };
    auth?: {
      getSession: () => Promise<WorkspaceSnapshot>;
      adoptSession: (issued: IssuedSession | null) => Promise<WorkspaceSnapshot>;
      renewSession: () => Promise<WorkspaceSnapshot>;
      signOut: () => Promise<void>;
      organizationRoster: () => Promise<OrganizationRoster>;
      organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
      openExternal: (url: string) => Promise<void>;
      getOAuthRedirectUri: () => Promise<string>;
      onOAuthCallback: (callback: (url: string) => void) => () => void;
      onSessionChange: (callback: (snapshot: WorkspaceSnapshot) => void) => () => void;
    };
    serverApi?: {
      analyseInvoices: (input: {
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      }) => Promise<InvoiceExtraction>;
    };
    updater?: {
      check: () => Promise<void>;
      download: () => Promise<void>;
      install: () => void;
      onEvent: (callback: (event: UpdaterEvent) => void) => () => void;
    };
  }
}

export {};
