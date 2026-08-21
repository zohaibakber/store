import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import * as React from "react";

import { storeErrorMessage, toastStoreError } from "@/lib/errors";

export interface AuthSessionBridge {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  /** Picks up an organization rename or a redeemed invitation. */
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly organizationRoster: () => Promise<OrganizationRoster>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult>;
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
const authScope = (snapshot: WorkspaceSnapshot | null): string | null =>
  snapshot?.status === "authenticated" && snapshot.activeOrganization
    ? `${snapshot.user.id}:${snapshot.activeOrganization.id}`
    : null;

let sessionBridge: AuthSessionBridge | undefined;

export const setAuthSessionBridge = (bridge: AuthSessionBridge) => {
  sessionBridge = bridge;
};

export const authSession = (): AuthSessionBridge => {
  const bridge = sessionBridge ?? globalThis.window?.auth;
  if (!bridge) throw new Error("Authentication is unavailable in this build.");
  return bridge;
};

/** The session read once at startup, handed to {@link AuthProvider} as props. */
export type InitialAuth =
  | { readonly _tag: "Session"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Failed"; readonly error: string };

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
    return { _tag: "Session", snapshot: await authSession().getSession() };
  } catch (cause) {
    return { _tag: "Failed", error: storeErrorMessage(cause) };
  }
}

const initialSnapshot = (initial: InitialAuth): WorkspaceSnapshot | null =>
  initial._tag === "Session" ? initial.snapshot : null;

const initialError = (initial: InitialAuth): string | null =>
  initial._tag === "Failed" ? initial.error : (initial.snapshot.workspaceError ?? null);

export function AuthProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: InitialAuth;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(
    initialSnapshot(initial),
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(initialError(initial));
  const currentScopeRef = React.useRef(authScope(snapshot));
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

  const value: AuthContextValue = loading
    ? { _tag: "Loading", snapshot, refresh }
    : error
      ? { _tag: "Error", snapshot, error, refresh }
      : snapshot
        ? { _tag: "Ready", snapshot, refresh }
        : { _tag: "Loading", snapshot: null, refresh };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
export type { WorkspaceSnapshot };
