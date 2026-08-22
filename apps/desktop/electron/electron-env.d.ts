/// <reference types="vite-plugin-electron/electron-env" />

import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { InvoiceExtraction, OfflineStoreApi, WorkspaceSnapshot } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
    }
  }

  interface Window {
    offlineStore?: OfflineStoreApi;
    electronTheme?: {
      setSource: (source: "dark" | "light" | "system") => void;
    };
    auth?: {
      getSession: () => Promise<WorkspaceSnapshot>;
      adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
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
