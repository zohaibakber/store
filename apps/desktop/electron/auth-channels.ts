import type {
  IdentifyInput,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";

import type { SignInCredentials } from "../src/host";

export const AUTH_GET_SESSION_CHANNEL = "auth:get-session";
export const AUTH_IDENTIFY_CHANNEL = "auth:identify";
export const AUTH_AUTHENTICATE_CHANNEL = "auth:authenticate";
export const AUTH_BEGIN_GOOGLE_CHANNEL = "auth:begin-google";
export const AUTH_COMPLETE_GOOGLE_CHANNEL = "auth:complete-google";
export const AUTH_RENEW_SESSION_CHANNEL = "auth:renew-session";
export const AUTH_SIGN_OUT_CHANNEL = "auth:sign-out";
export const AUTH_ORGANIZATION_CHANNEL = "auth:organization";
export const AUTH_ORGANIZE_CHANNEL = "auth:organize";
export const AUTH_SESSION_CHANGED_CHANNEL = "auth:session-changed";

export type AuthIpcBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly identify: (input: IdentifyInput) => Promise<LoginRoute>;
  readonly authenticate: (credentials: SignInCredentials) => Promise<WorkspaceSnapshot>;
  readonly beginGoogle: () => Promise<void>;
  readonly completeGoogle: (callbackUrl: string) => Promise<WorkspaceSnapshot | null>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  readonly onOAuthCallback: (callback: (url: string) => void) => () => void;
  readonly onSessionChange: (callback: (snapshot: WorkspaceSnapshot) => void) => () => void;
};
