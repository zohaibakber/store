/// <reference types="vite/client" />

import type { InvoiceExtraction, WorkspaceSnapshot } from "@store/contracts";

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_CLERK_JWT_TEMPLATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __APP_VERSION__: string;

  interface Window {
    auth?: {
      getSession(): Promise<WorkspaceSnapshot>;
      adoptSession(token: string | null): Promise<WorkspaceSnapshot>;
      signOut(): Promise<void>;
      onSessionChange(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
    };
    serverApi?: {
      analyseInvoices(input: {
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      }): Promise<InvoiceExtraction>;
    };
  }
}
