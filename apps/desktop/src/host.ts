import type {
  AuthClientKind,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";

import type { InvoiceUploadFile } from "@/lib/invoice-upload";
import type { NewSaleShortcut } from "@/lib/new-sale-shortcut";

export type AuthSessionBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
};

/** How this host signs in: the client kind the auth Worker sees and the Google redirect leg. */
export type SignInBridge = {
  readonly client: AuthClientKind;
  readonly oauthRedirectUri: () => Promise<string>;
  readonly openAuthorization: (url: string) => Promise<void>;
  /** Delivers the OAuth callback URL once, including one that arrived before the listener. */
  readonly onOAuthCallback?: (listener: (url: string) => void) => () => void;
};

export type AppUpdaterBridge = {
  readonly check: () => Promise<void>;
  readonly download: () => Promise<void>;
  readonly install: () => void;
  readonly onEvent: (listener: (event: UpdaterEvent) => void) => () => void;
};

export type ThemeSource = "dark" | "light" | "system";

/**
 * Everything the renderer needs from the process that hosts it. Electron
 * builds it from the preload bridge, the browser from its own session broker.
 * Optional members are capabilities only some hosts have.
 */
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

/** Install once at startup, before anything reads the session. */
export const installAppHost = (host: AppHost): AppHost => {
  installed = host;
  return host;
};

export const appHost = (): AppHost => {
  if (!installed) throw new Error("The app host is not installed.");
  return installed;
};
