import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { WorkspaceSnapshot } from "@store/contracts";
import { unauthenticatedWorkspace } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { appHost } from "@/host";
import type { OpenWorkspace, Workspace } from "@/host-access";
import { storeErrorMessage, toastStoreError } from "@/lib/errors";
import { refreshWorkspaceSession, workspaceSessionAtom } from "@/session/workspace-session";

type AuthContextValue = {
  readonly refresh: () => Promise<void>;
  readonly workspace: Workspace;
  readonly workspaces: ReadonlyArray<OpenWorkspace>;
} & (
  | { readonly _tag: "Loading"; readonly snapshot: WorkspaceSnapshot | null }
  | { readonly _tag: "Ready"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Error"; readonly snapshot: WorkspaceSnapshot | null; readonly error: string }
);

class AuthProviderMissing extends Schema.TaggedError<AuthProviderMissing>()(
  "AuthProviderMissing",
  {},
) {}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export async function signOut() {
  try {
    await appHost().auth.signOut();
  } catch (error) {
    toastStoreError(error);
  }
}

export async function bootstrapAuth(): Promise<WorkspaceSnapshot> {
  try {
    return await appHost().auth.getSession();
  } catch (cause) {
    return unauthenticatedWorkspace({
      isOnline: false,
      workspaceError: storeErrorMessage(cause),
    });
  }
}

export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const { access } = router.options.context;
  const current = useAtomValue(workspaceSessionAtom);
  const refreshSession = useAtomSet(refreshWorkspaceSession, { mode: "promise" });

  const refresh = React.useCallback(async () => {
    try {
      await refreshSession();
    } catch (cause) {
      toastStoreError(cause);
    }
  }, [refreshSession]);

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
  if (!value) throw new AuthProviderMissing();
  return value;
}
