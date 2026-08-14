/// <reference types="vite/client" />

import type { InvoiceExtraction, OfflineStoreApi, WorkspaceSnapshot } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";

declare global {
  const __APP_VERSION__: string;

  interface Window {
    auth?: {
      getSession(): Promise<WorkspaceSnapshot>;
      signIn(input: { email: string; password: string }): Promise<WorkspaceSnapshot>;
      signUp(input: { name: string; email: string; password: string }): Promise<WorkspaceSnapshot>;
      signOut(): Promise<void>;
      switchOrganization(input: { organizationId: string }): Promise<WorkspaceSnapshot>;
      createOrganization(input: { name: string }): Promise<WorkspaceSnapshot>;
      onSessionChange(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
    };
    serverApi?: {
      analyseInvoices(input: {
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      }): Promise<InvoiceExtraction>;
    };
    offlineStore?: OfflineStoreApi;
    updater?: {
      check: () => Promise<void>;
      download: () => Promise<void>;
      install: () => void;
      onEvent: (callback: (event: UpdaterEvent) => void) => () => void;
    };
    windowControls?: {
      minimize: () => void;
      toggleMaximize: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      isFullScreen: () => Promise<boolean>;
      onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void;
      close: () => void;
    };
  }
}
