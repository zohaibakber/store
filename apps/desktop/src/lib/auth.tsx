import { useRouter } from "@tanstack/react-router";
import * as React from "react";

export type AuthUser = { id: string; name: string; email: string; image?: string | null };
export type AuthOrganization = { id: string; name: string; slug?: string | null; role: string };
export type AuthSnapshot = {
  status: "authenticated" | "unauthenticated";
  user: AuthUser | null;
  activeOrganization: AuthOrganization | null;
  organizations: AuthOrganization[];
  isOnline: boolean;
};

declare global {
  interface WindowEventMap {
    "auth:session": CustomEvent<AuthSnapshot>;
  }
}

type AuthContextValue = {
  snapshot: AuthSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
const AuthContext = React.createContext<AuthContextValue | null>(null);
const authScope = (snapshot: AuthSnapshot | null): string | null =>
  snapshot?.status === "authenticated" && snapshot.user && snapshot.activeOrganization
    ? `${snapshot.user.id}:${snapshot.activeOrganization.id}`
    : null;

const messageFrom = (error: unknown) => {
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
};

// The main process settles the session before the window loads, so resolving it
// once before the first React render means the initial paint is already correct
// and the sign-in screen never flashes for signed-in users.
let initialSnapshot: AuthSnapshot | null = null;
let initialError: string | null = null;

export async function bootstrapAuth() {
  try {
    if (!window.auth) throw new Error("Authentication is unavailable in this build.");
    initialSnapshot = await window.auth.getSession();
  } catch (cause) {
    initialError = messageFrom(cause);
  }
  return initialSnapshot;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = React.useState<AuthSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = React.useState(initialSnapshot === null && initialError === null);
  const [error, setError] = React.useState<string | null>(initialError);
  const currentScopeRef = React.useRef(authScope(initialSnapshot));
  const pendingScopeRef = React.useRef<string | null | undefined>(undefined);
  const transitionRef = React.useRef(0);

  const apply = React.useCallback(
    async (next: AuthSnapshot) => {
      const nextScope = authScope(next);
      if (nextScope === pendingScopeRef.current) return;
      if (nextScope === currentScopeRef.current && pendingScopeRef.current === undefined) {
        setSnapshot(next);
        setError(null);
        setLoading(false);
        return;
      }

      const transition = transitionRef.current + 1;
      transitionRef.current = transition;
      pendingScopeRef.current = nextScope;
      setError(null);
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
      if (!window.auth) throw new Error("Authentication is unavailable in this build.");
      await apply(await window.auth.getSession());
    } catch (cause) {
      setError(messageFrom(cause));
      setLoading(false);
    }
  }, [apply]);

  React.useEffect(() => {
    const dispose = window.auth?.onSessionChange((next) => void apply(next));
    const handleLocal = (event: CustomEvent<AuthSnapshot>) => void apply(event.detail);
    window.addEventListener("auth:session", handleLocal);
    return () => {
      dispose?.();
      window.removeEventListener("auth:session", handleLocal);
    };
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
export const getErrorMessage = messageFrom;
