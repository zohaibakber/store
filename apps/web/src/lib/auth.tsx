import type { WorkspaceSnapshot } from "@store/contracts";
import { unauthenticatedWorkspace } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import * as React from "react";

import { appHost, type AuthSessionBridge } from "@/host";
import type { OpenWorkspace, Workspace } from "@/host-access";
import { storeErrorMessage, toastStoreError } from "@/lib/errors";
import { refreshBoundWorkspaceSession, type WorkspaceSession } from "@/session/workspace-session";

type AuthContextValue = {
  readonly refresh: () => Promise<void>;
  readonly workspace: Workspace;
  readonly workspaces: ReadonlyArray<OpenWorkspace>;
} & (
  | { readonly _tag: "Loading"; readonly snapshot: WorkspaceSnapshot | null }
  | { readonly _tag: "Ready"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Error"; readonly snapshot: WorkspaceSnapshot | null; readonly error: string }
);

const AuthContext = React.createContext<AuthContextValue | null>(null);

export const authSession = (): AuthSessionBridge => appHost().auth;

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

export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const { access, session } = router.options.context;
  const current =
    React.useSyncExternalStore(session.subscribe, session.current) ?? fallbackSession();

  const refresh = React.useCallback(async () => {
    try {
      await refreshBoundWorkspaceSession();
    } catch (cause) {
      toastStoreError(cause);
    }
  }, []);

  const snapshot = current.snapshot;
  const error = snapshot.workspaceError ?? null;
  const shared = {
    snapshot,
    refresh,
    workspace: access.workspace(snapshot),
    workspaces: access.workspaces(snapshot),
  };
  const value: AuthContextValue =
    current._tag === "Switching"
      ? { _tag: "Loading", ...shared }
      : error
        ? { _tag: "Error", error, ...shared }
        : { _tag: "Ready", ...shared };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
