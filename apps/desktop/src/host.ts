import type {
  AuthClientKind,
  IssuedSession,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";

import type { InvoiceUploadFile } from "@/lib/invoice-upload";
import type { NewSaleShortcut } from "@/lib/new-sale-shortcut";

export type AuthSessionBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (issued: IssuedSession | null) => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
};

export type SignInBridge = {
  readonly client: AuthClientKind;
  readonly oauthRedirectUri: () => Promise<string>;
  readonly openAuthorization: (url: string) => Promise<void>;
  readonly onOAuthCallback?: (listener: (url: string) => void) => () => void;
};

export type AppUpdaterBridge = {
  readonly check: () => Promise<void>;
  readonly download: () => Promise<void>;
  readonly install: () => void;
  readonly onEvent: (listener: (event: UpdaterEvent) => void) => () => void;
};

export type ThemeSource = "dark" | "light" | "system";

export interface AppHost {
  readonly auth: AuthSessionBridge;
  readonly signIn: SignInBridge;
  readonly analyseInvoices: (files: ReadonlyArray<InvoiceUploadFile>) => Promise<InvoiceExtraction>;
  readonly newSaleShortcut: NewSaleShortcut;
  readonly shell?: { readonly onNewSale: (listener: () => void) => () => void };
  readonly updater?: AppUpdaterBridge;
  readonly theme?: { readonly setSource: (source: ThemeSource) => void };
}

let installed: AppHost | null = null;

export const installAppHost = (host: AppHost) => {
  installed = host;
};

export const appHost = (): AppHost => {
  if (!installed) throw new Error("The app host is not installed.");
  return installed;
};
