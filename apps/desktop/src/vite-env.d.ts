/// <reference types="vite/client" />

import type { AuthSnapshot } from "@/lib/auth";
import type { InvoiceExtraction, ModelCatalogResponse } from "@store/contracts";

declare global {
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
      getModels(): Promise<ModelCatalogResponse>;
      analyseInvoices(input: {
        model: string;
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      }): Promise<InvoiceExtraction>;
    };
  }
}
