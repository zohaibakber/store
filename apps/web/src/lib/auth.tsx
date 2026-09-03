import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import { unauthenticatedWorkspace } from "@store/contracts";
import type { JsonApiResponse, JsonRequestInit } from "@store/workspace";
import { useRouter } from "@tanstack/react-router";
import * as React from "react";

import { storeErrorMessage, toastStoreError } from "@/lib/errors";
import { refreshBoundWorkspaceSession, type WorkspaceSession } from "@/session/workspace-session";

export interface AuthSessionBridge {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  /** Picks up an organization rename or a redeemed invitation. */
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
  /** Bearer-authenticated store API. Web-only; Electron uses `window.serverApi`. */
  readonly apiRequest?: (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;
  /** Raw bearer-authenticated fetch for catalog replica HTTP. */
  readonly apiFetch?: typeof fetch;
  /** Stable host device namespace for idempotent mutations. */
  readonly deviceId?: string;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
}

type AuthContextValue = {
  readonly refresh: () => Promise<void>;
} & (
  | { readonly _tag: "Loading"; readonly snapshot: WorkspaceSnapshot | null }
  | { readonly _tag: "Ready"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Error"; readonly snapshot: WorkspaceSnapshot | null; readonly error: string }
);

const AuthContext = React.createContext<AuthContextValue | null>(null);

let sessionBridge: AuthSessionBridge | undefined;

export const setAuthSessionBridge = (bridge: AuthSessionBridge) => {
  sessionBridge = bridge;
};

export const authSession = (): AuthSessionBridge => {
  const bridge = sessionBridge ?? globalThis.window?.auth;
  if (!bridge) throw new Error("Authentication is unavailable in this build.");
  return bridge;
};

export async function signOut() {
  try {
    await authSession().signOut();
  } catch (error) {
    toastStoreError(error);
  }
}

export async function bootstrapAuth(): Promise<WorkspaceSnapshot> {
  try {
    return await authSession().getSession();
  } catch (cause) {
    return unauthenticatedWorkspace({
      isOnline: false,
      workspaceError: storeErrorMessage(cause),
    });
  }
}

const fallbackSession = (): WorkspaceSession => ({
  _tag: "Steady",
  snapshot: unauthenticatedWorkspace({ isOnline: false }),
});

/**
 * Subscriber of the live workspace session. Does not own writes, does not
 * seed from a frozen bootstrap snapshot, and does not live as the admit path.
 */
export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const session = router.options.context.session;
  const current = React.useSyncExternalStore(
    session.subscribe,
    () => session.current() ?? fallbackSession(),
    () => session.current() ?? fallbackSession(),
  );

  const refresh = React.useCallback(async () => {
    try {
      await refreshBoundWorkspaceSession();
    } catch (cause) {
      toastStoreError(cause);
    }
  }, []);

  const snapshot = current.snapshot;
  const error = snapshot.workspaceError ?? null;
  const value: AuthContextValue =
    current._tag === "Switching"
      ? { _tag: "Loading", snapshot, refresh }
      : error
        ? { _tag: "Error", snapshot, error, refresh }
        : { _tag: "Ready", snapshot, refresh };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
