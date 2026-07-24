/// <reference types="vite/client" />

import type { InvoiceExtraction } from "@store/contracts";

import type { AuthSnapshot } from "@/lib/auth";

declare global {
  const __APP_VERSION__: string;

  interface Window {
    auth?: {
      getSession(): Promise<AuthSnapshot>;
      signIn(input: { email: string; password: string }): Promise<AuthSnapshot>;
      signUp(input: { name: string; email: string; password: string }): Promise<AuthSnapshot>;
      signOut(): Promise<void>;
      switchOrganization(input: { organizationId: string }): Promise<AuthSnapshot>;
      createOrganization(input: { name: string }): Promise<AuthSnapshot>;
      onSessionChange(listener: (snapshot: AuthSnapshot) => void): () => void;
    };
    serverApi?: {
      analyseInvoices(input: {
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      }): Promise<InvoiceExtraction>;
    };
  }
}
