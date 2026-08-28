import type { AuthenticatedWorkspaceSnapshot } from "@store/contracts";
import { useRouter } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  clearMobileTokens,
  exchangeGoogleIdTokenMobile,
  fetchWorkspaceSession,
  readWorkspaceSnapshot,
  refreshMobileSession,
  restoreTokens,
  saveWorkspaceSnapshot,
  signOutMobile,
  subscribeWorkspaceAfterRefresh,
} from "@/lib/auth-client";
import { forgetGoogleAccount, signInWithGoogleAccount } from "@/lib/google-signin";
import { hapticSuccess } from "@/lib/haptics";
import { rememberLastUserId } from "@/lib/local-session";
import { Sentry } from "@/lib/sentry";

/** Mobile has no guest mode: without a session there is no inventory to open. */
type SignedOutAuth = {
  readonly _tag: "SignedOut";
  readonly inventoryUserId: null;
  readonly workspace: null;
};

type AuthenticatedAuth = {
  readonly _tag: "Authenticated";
  readonly inventoryUserId: string;
  readonly workspace: AuthenticatedWorkspaceSnapshot;
};

type LoadingAuth = {
  readonly _tag: "Loading";
  readonly inventoryUserId: null;
  readonly workspace: null;
};

export type MobileAuthState = LoadingAuth | SignedOutAuth | AuthenticatedAuth;

interface MobileAuthActions {
  readonly reload: () => Promise<void>;
  readonly completeAuthentication: () => Promise<void>;
  readonly signInWithGoogle: () => Promise<void>;
  readonly signOut: (everywhere?: boolean) => Promise<void>;
}

interface MobileAuthContextValue {
  readonly state: MobileAuthState;
  readonly actions: MobileAuthActions;
}

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

const signedOut: SignedOutAuth = { _tag: "SignedOut", inventoryUserId: null, workspace: null };

const authenticatedState = async (
  workspace: AuthenticatedWorkspaceSnapshot,
): Promise<AuthenticatedAuth> => {
  await rememberLastUserId(workspace.user.id);
  await saveWorkspaceSnapshot(workspace);
  return { _tag: "Authenticated", inventoryUserId: workspace.user.id, workspace };
};

export function MobileAuthProvider({ children }: PropsWithChildren) {
  const { replace } = useRouter();
  const [state, setState] = useState<MobileAuthState>({
    _tag: "Loading",
    inventoryUserId: null,
    workspace: null,
  });

  const load = useCallback(async () => {
    const restored = await restoreTokens();
    if (!restored) {
      setState(signedOut);
      return;
    }

    try {
      await refreshMobileSession();
      const workspace = await fetchWorkspaceSession();
      if (workspace.status === "authenticated") {
        setState(await authenticatedState(workspace));
        return;
      }
      await clearMobileTokens();
      setState(signedOut);
    } catch {
      const stillHaveTokens = (await restoreTokens()) !== null;
      const cached = stillHaveTokens ? await readWorkspaceSnapshot() : null;
      if (cached) {
        setState(
          await authenticatedState({
            ...cached,
            isOnline: false,
            workspaceError: "Offline. Changes will sync after you reconnect.",
          }),
        );
        return;
      }
      setState(signedOut);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state._tag === "Authenticated") {
      Sentry.setUser({ id: state.inventoryUserId });
      return;
    }
    Sentry.setUser(null);
  }, [state]);

  useEffect(
    () =>
      subscribeWorkspaceAfterRefresh((workspace) => {
        void authenticatedState(workspace).then(setState);
      }),
    [],
  );

  const completeAuthentication = useCallback(async () => {
    const workspace = await fetchWorkspaceSession();
    if (workspace.status !== "authenticated") {
      await clearMobileTokens();
      throw new Error("The API did not accept the new session.");
    }
    setState(await authenticatedState(workspace));
    hapticSuccess();
    replace("/home");
  }, [replace]);

  const signInWithGoogle = useCallback(async () => {
    const result = await signInWithGoogleAccount();
    if (result._tag === "Cancelled") return;
    await exchangeGoogleIdTokenMobile(result.idToken);
    await completeAuthentication();
  }, [completeAuthentication]);

  const signOut = useCallback(
    async (everywhere = false) => {
      let failure: unknown;
      try {
        await signOutMobile(everywhere);
      } catch (cause) {
        failure = cause;
      }
      try {
        await forgetGoogleAccount();
      } catch (cause) {
        failure ??= cause;
      }
      setState(signedOut);
      replace("/auth");
      if (failure !== undefined) throw failure;
    },
    [replace],
  );

  const actions = useMemo(
    () => ({ reload: load, completeAuthentication, signInWithGoogle, signOut }),
    [completeAuthentication, load, signInWithGoogle, signOut],
  );
  const value = useMemo(() => ({ state, actions }), [actions, state]);

  return <MobileAuthContext value={value}>{children}</MobileAuthContext>;
}

export function useMobileAuth() {
  const value = use(MobileAuthContext);
  if (!value) throw new Error("useMobileAuth must be used within MobileAuthProvider.");
  return value;
}
