/// <reference types="vite/client" />

import type { InvoiceExtraction, WorkspaceSnapshot } from "@store/contracts";

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
  }
}
