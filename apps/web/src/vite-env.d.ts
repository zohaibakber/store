/// <reference types="vite/client" />

import type { TokenSet } from "@store/auth";
import type { InvoiceExtraction, OfflineStoreApi, WorkspaceSnapshot } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";

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

  interface Window {
    auth?: {
      getSession(): Promise<WorkspaceSnapshot>;
      adoptSession(tokens: TokenSet | null): Promise<WorkspaceSnapshot>;
      signOut(): Promise<void>;
      openExternal(url: string): Promise<void>;
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
    offlineStore?: OfflineStoreApi;
    updater?: {
      check: () => Promise<void>;
      download: () => Promise<void>;
      install: () => void;
      onEvent: (callback: (event: UpdaterEvent) => void) => () => void;
    };
  }
}
