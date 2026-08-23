/// <reference types="vite/client" />

import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { InvoiceExtraction, WorkspaceSnapshot } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";
import type { JsonApiResponse } from "@store/workspace";
import type { ElectronSQLitePersistenceOptions } from "@tanstack/electron-db-sqlite-persistence";

type ElectronPersistenceInvoke = NonNullable<ElectronSQLitePersistenceOptions["invoke"]>;
type ElectronPersistenceRequest = Parameters<ElectronPersistenceInvoke>[1];
type ElectronPersistenceResponse = Awaited<ReturnType<ElectronPersistenceInvoke>>;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AUTH_URL?: string;
  readonly VITE_ELECTRON?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __APP_VERSION__: string;

  interface WindowEventMap {
    "tabaaq:google-auth-error": CustomEvent<string>;
  }

  interface Window {
    inventoryHttp?: {
      getConfig(): Promise<{ apiBaseUrl: string; deviceId: string }>;
      request(input: {
        requestId: string;
        url: string;
        method: "GET" | "POST";
        headers: ReadonlyArray<readonly [string, string]>;
        body: ArrayBuffer | null;
      }): Promise<{
        status: number;
        statusText: string;
        headers: ReadonlyArray<readonly [string, string]>;
        body: ArrayBuffer;
      }>;
      abort(requestId: string): void;
    };
    tanstackDbPersistence?: {
      invoke(request: ElectronPersistenceRequest): Promise<ElectronPersistenceResponse>;
    };
    legacyLocalInventory?: {
      load(): Promise<JsonApiResponse>;
    };
    auth?: {
      getSession(): Promise<WorkspaceSnapshot>;
      adoptSession(tokens: TokenSet | null): Promise<WorkspaceSnapshot>;
      renewSession(): Promise<WorkspaceSnapshot>;
      signOut(): Promise<void>;
      organizationRoster(): Promise<OrganizationRoster>;
      organize(command: OrganizationCommand): Promise<OrganizationCommandResult>;
      apiRequest?(
        pathname: string,
        init?: import("@store/workspace").JsonRequestInit,
      ): Promise<import("@store/workspace").JsonApiResponse>;
      openExternal(url: string): Promise<void>;
      getOAuthRedirectUri(): Promise<string>;
      onOAuthCallback(listener: (url: string) => void): () => void;
      onSessionChange(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
    };
    serverApi?: {
      analyseInvoices(input: {
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      }): Promise<InvoiceExtraction>;
    };
    electronTheme?: {
      setSource: (source: "dark" | "light" | "system") => void;
    };
    updater?: {
      check: () => Promise<void>;
      download: () => Promise<void>;
      install: () => void;
      onEvent: (callback: (event: UpdaterEvent) => void) => () => void;
    };
  }
}
