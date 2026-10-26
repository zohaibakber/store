import type {
  IdentifyInput,
  LoginCredentials,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import type { GlobalProductSearchResult } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

import type { InventoryHttpBridge, ReplicaWorkspaceBridge } from "./electron";
import type { PrintOutcome, PrintPage, SavePdfOutcome } from "./share";
import {
  ExternalLinkRefused,
  ServerRequestFailed,
  SignInFailed,
  WorkspaceOpenFailed,
  type ThemeSource,
} from "./shell-rpcs";
import type { WorkspaceBackupBridge } from "./workspace-backup";
import type { WorkspacePublishBridge } from "./workspace-publish";

export type AuthSessionBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  readonly sessionChanges: Stream.Stream<WorkspaceSnapshot>;
};

type WithoutClient<Command> = Command extends unknown ? Omit<Command, "client"> : never;

export type SignInCredentials = WithoutClient<LoginCredentials>;

export type SignInBridge = {
  readonly identify: (input: IdentifyInput) => Promise<LoginRoute>;
  readonly authenticate: (credentials: SignInCredentials) => Promise<WorkspaceSnapshot>;
  readonly beginGoogle: () => Promise<void>;
  readonly completeGoogle: (callbackUrl: string) => Promise<WorkspaceSnapshot | null>;
  readonly onOAuthCallback: (listener: (url: string) => void) => () => void;
};

export type AppUpdaterBridge = {
  readonly check: () => Promise<void>;
  readonly install: () => void;
  readonly onEvent: (listener: (event: UpdaterEvent) => void) => () => void;
};

export type ThemeBridge = { readonly setSource: (source: ThemeSource) => void };

export type WindowControlsBridge = {
  readonly minimize: () => void;
  readonly toggleMaximize: () => void;
  readonly close: () => void;
  readonly isMaximized: () => boolean;
  readonly onMaximizedChange: (listener: () => void) => () => void;
};

export type DesktopShellBridge = {
  readonly onNewSale: (listener: () => void) => () => void;
  readonly window: WindowControlsBridge;
};

export interface AppHost {
  readonly auth: AuthSessionBridge;
  readonly signIn: SignInBridge;
  readonly searchGlobalProducts: (query: string) => Promise<GlobalProductSearchResult>;
  readonly shell: DesktopShellBridge;
  readonly updater?: AppUpdaterBridge;
  readonly theme: ThemeBridge;
  readonly backup: WorkspaceBackupBridge;
  readonly openExternal: (url: string) => Promise<void>;
  readonly copyText: (text: string) => Promise<void>;
  readonly savePdf: (fileStem: string) => Promise<SavePdfOutcome>;
  readonly print: (page: PrintPage) => Promise<PrintOutcome>;
  readonly publish: WorkspacePublishBridge;
  readonly inventoryHttp: InventoryHttpBridge;
  readonly replica: ReplicaWorkspaceBridge;
}

export class BridgeInterrupted extends Schema.TaggedError<BridgeInterrupted>()(
  "BridgeInterrupted",
  {},
) {}

export const BridgeFailure = Schema.Union([
  SignInFailed,
  ServerRequestFailed,
  ExternalLinkRefused,
  WorkspaceOpenFailed,
  BridgeInterrupted,
]);
export type BridgeFailure = typeof BridgeFailure.Type;

export const isBridgeFailure = Schema.is(BridgeFailure);

class AppHostMissing extends Schema.TaggedError<AppHostMissing>()("AppHostMissing", {}) {}

let installed: AppHost | null = null;

export const installAppHost = (host: AppHost) => {
  installed = host;
};

export const appHost = (): AppHost => {
  if (!installed) throw new AppHostMissing();
  return installed;
};
