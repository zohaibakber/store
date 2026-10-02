import type {
  IdentifyInput,
  LoginCommand,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";

import type { InvoiceUploadFile } from "@/lib/invoice-upload";
import type { NewSaleShortcut } from "@/lib/new-sale-shortcut";
import type { SavePdfOutcome } from "@/lib/share";
import type { WorkspaceBackupBridge } from "@/lib/workspace-backup";
import type { WorkspacePublishBridge } from "@/lib/workspace-publish";

export type AuthSessionBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
};

type WithoutClient<Command> = Command extends unknown ? Omit<Command, "client"> : never;

export type SignInCredentials = WithoutClient<LoginCommand>;

export type SignInBridge = {
  readonly identify: (input: IdentifyInput) => Promise<LoginRoute>;
  readonly authenticate: (credentials: SignInCredentials) => Promise<WorkspaceSnapshot>;
  readonly beginGoogle: () => Promise<void>;
  readonly completeGoogle: (callbackUrl: string) => Promise<WorkspaceSnapshot | null>;
  readonly onOAuthCallback?: (listener: (url: string) => void) => () => void;
  readonly hasPendingOAuthCallback?: () => boolean;
};

export type AppUpdaterBridge = {
  readonly check: () => Promise<void>;
  readonly download: () => Promise<void>;
  readonly install: () => void;
  readonly onEvent: (listener: (event: UpdaterEvent) => void) => () => void;
};

export type ThemeSource = "dark" | "light" | "system";

export type ThemeBridge = { readonly setSource: (source: ThemeSource) => void };

export type DesktopShellBridge = {
  readonly onNewSale: (listener: () => void) => () => void;
};

export interface AppHost {
  readonly auth: AuthSessionBridge;
  readonly signIn: SignInBridge;
  readonly analyseInvoices: (files: ReadonlyArray<InvoiceUploadFile>) => Promise<InvoiceExtraction>;
  readonly newSaleShortcut: NewSaleShortcut;
  readonly shell?: DesktopShellBridge;
  readonly updater?: AppUpdaterBridge;
  readonly theme?: ThemeBridge;
  readonly backup?: WorkspaceBackupBridge;
  readonly openExternal: (url: string) => Promise<void>;
  readonly copyText: (text: string) => Promise<void>;
  readonly savePdf: (fileStem: string) => Promise<SavePdfOutcome>;
  readonly publish?: WorkspacePublishBridge;
}

let installed: AppHost | null = null;

export const installAppHost = (host: AppHost) => {
  installed = host;
};

export const appHost = (): AppHost => {
  if (!installed) throw new Error("The app host is not installed.");
  return installed;
};
