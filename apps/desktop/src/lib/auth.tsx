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

type AuthContextValue = {
  snapshot: AuthSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
const AuthContext = React.createContext<AuthContextValue | null>(null);
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
  const [snapshot, setSnapshot] = React.useState<AuthSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = React.useState(initialSnapshot === null && initialError === null);
  const [error, setError] = React.useState<string | null>(initialError);
  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!window.auth) throw new Error("Authentication is unavailable in this build.");
      setSnapshot(await window.auth.getSession());
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (initialSnapshot === null && initialError === null) void refresh();
    const apply = (next: AuthSnapshot) => {
      setSnapshot(next);
      setError(null);
      setLoading(false);
    };
    const dispose = window.auth?.onSessionChange(apply);
    const handleLocal = (event: Event) => apply((event as CustomEvent<AuthSnapshot>).detail);
    window.addEventListener("auth:session", handleLocal);
    return () => {
      dispose?.();
      window.removeEventListener("auth:session", handleLocal);
    };
  }, [refresh]);

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
