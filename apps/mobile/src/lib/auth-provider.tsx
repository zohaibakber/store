import { type AuthenticatedWorkspaceSnapshot, unauthenticatedWorkspace } from "@store/contracts";
import * as AuthSession from "expo-auth-session";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
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
  beginGoogleMobile,
  clearMobileTokens,
  exchangeGoogleMobile,
  fetchWorkspaceSession,
  mobileApplicationId,
  readWorkspaceSnapshot,
  refreshMobileSession,
  restoreTokens,
  saveWorkspaceSnapshot,
  signOutMobile,
} from "@/lib/auth-client";
import { localInventoryUserId, rememberLastUserId } from "@/lib/local-session";
import { resetProductsSession } from "@/lib/products";

WebBrowser.maybeCompleteAuthSession();

type AnonymousAuth = {
  readonly _tag: "Anonymous";
  readonly inventoryUserId: string;
  readonly workspace: ReturnType<typeof unauthenticatedWorkspace>;
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

export type MobileAuthState = LoadingAuth | AnonymousAuth | AuthenticatedAuth;

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

const anonymousState = async (): Promise<AnonymousAuth> => ({
  _tag: "Anonymous",
  inventoryUserId: await localInventoryUserId(),
  workspace: unauthenticatedWorkspace({ isOnline: false }),
});

const authenticatedState = async (
  workspace: AuthenticatedWorkspaceSnapshot,
): Promise<AuthenticatedAuth> => {
  await rememberLastUserId(workspace.user.id);
  await saveWorkspaceSnapshot(workspace);
  return { _tag: "Authenticated", inventoryUserId: workspace.user.id, workspace };
};

export function MobileAuthProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const [state, setState] = useState<MobileAuthState>({
    _tag: "Loading",
    inventoryUserId: null,
    workspace: null,
  });

  const load = useCallback(async () => {
    const restored = await restoreTokens();
    if (!restored) {
      setState(await anonymousState());
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
      setState(await anonymousState());
    } catch {
      const cached = await readWorkspaceSnapshot();
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
      setState(await anonymousState());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completeAuthentication = useCallback(async () => {
    const workspace = await fetchWorkspaceSession();
    if (workspace.status !== "authenticated") {
      await clearMobileTokens();
      throw new Error("The API did not accept the new session.");
    }
    resetProductsSession();
    setState(await authenticatedState(workspace));
    router.replace("/home");
  }, [router]);

  const signInWithGoogle = useCallback(async () => {
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: mobileApplicationId,
      path: "auth/callback",
    });
    const { authorization, verifier } = await beginGoogleMobile(redirectUri);
    const result = await WebBrowser.openAuthSessionAsync(authorization.url, redirectUri);
    if (result.type !== "success") return;
    const code = new URL(result.url).searchParams.get("code");
    if (!code) throw new Error("Google did not return an authorization code.");
    await exchangeGoogleMobile({ code, verifier });
    await completeAuthentication();
  }, [completeAuthentication]);

  const signOut = useCallback(
    async (everywhere = false) => {
      await signOutMobile(everywhere);
      resetProductsSession();
      setState(await anonymousState());
      router.replace("/home");
    },
    [router],
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
