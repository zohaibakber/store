import type { WorkspaceSnapshot } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import * as React from "react";

import { storeErrorMessage, toastStoreError } from "@/lib/errors";

export interface AuthSessionBridge {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly signIn: (input: {
    readonly email: string;
    readonly password: string;
  }) => Promise<WorkspaceSnapshot>;
  readonly signUp: (input: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  }) => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly switchOrganization: (input: {
    readonly organizationId: string;
  }) => Promise<WorkspaceSnapshot>;
  readonly createOrganization: (input: { readonly name: string }) => Promise<WorkspaceSnapshot>;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
}

type AuthContextValue = {
  snapshot: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
const AuthContext = React.createContext<AuthContextValue | null>(null);
const authScope = (snapshot: WorkspaceSnapshot | null): string | null =>
  snapshot?.status === "authenticated" && snapshot.user && snapshot.activeOrganization
    ? `${snapshot.user.id}:${snapshot.activeOrganization.id}`
    : null;

let sessionBridge: AuthSessionBridge | undefined;

export const setAuthSessionBridge = (bridge: AuthSessionBridge) => {
  sessionBridge = bridge;
};

export const authSession = (): AuthSessionBridge => {
  const bridge = sessionBridge ?? (typeof window === "undefined" ? undefined : window.auth);
  if (!bridge) throw new Error("Authentication is unavailable in this build.");
  return bridge;
};

/** The session read once at startup, handed to {@link AuthProvider} as props. */
export interface InitialAuth {
  readonly snapshot: WorkspaceSnapshot | null;
  readonly error: string | null;
}

/** Ends the session; the host broadcasts the resulting snapshot. */
export async function signOut() {
  try {
    await authSession().signOut();
  } catch (error) {
    toastStoreError(error);
  }
}

export async function bootstrapAuth(): Promise<InitialAuth> {
  try {
    const snapshot = await authSession().getSession();
    return { snapshot, error: snapshot.workspaceError ?? null };
  } catch (cause) {
    return { snapshot: null, error: storeErrorMessage(cause) };
  }
}

export function AuthProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: InitialAuth;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(initial.snapshot);
  const [loading, setLoading] = React.useState(initial.snapshot === null && initial.error === null);
  const [error, setError] = React.useState<string | null>(initial.error);
  const currentScopeRef = React.useRef(authScope(initial.snapshot));
  const pendingScopeRef = React.useRef<string | null | undefined>(undefined);
  const transitionRef = React.useRef(0);

  const apply = React.useCallback(
    async (next: WorkspaceSnapshot) => {
      const nextScope = authScope(next);
      if (nextScope === pendingScopeRef.current) return;
      if (nextScope === currentScopeRef.current && pendingScopeRef.current === undefined) {
        setSnapshot(next);
        setError(next.workspaceError ?? null);
        setLoading(false);
        return;
      }

      const transition = transitionRef.current + 1;
      transitionRef.current = transition;
      pendingScopeRef.current = nextScope;
      setError(next.workspaceError ?? null);
      setLoading(true);

      if (nextScope === null) {
        router.clearCache();
      } else {
        await router.invalidate().catch(() => undefined);
      }

      if (transition !== transitionRef.current) return;
      currentScopeRef.current = nextScope;
      pendingScopeRef.current = undefined;
      setSnapshot(next);
      setLoading(false);
    },
    [router],
  );

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apply(await authSession().getSession());
    } catch (cause) {
      setError(storeErrorMessage(cause));
      setLoading(false);
    }
  }, [apply]);

  React.useEffect(() => {
    const bridge = sessionBridge ?? window.auth;
    if (!bridge) return;
    const dispose = bridge.onSessionChange((next) => void apply(next));
    return () => dispose();
  }, [apply]);

  return (
    <AuthContext.Provider value={{ snapshot, loading, error, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
export type { WorkspaceSnapshot };
