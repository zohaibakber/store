import { clerkTokenOptions, clerkTokenRefreshDelay } from "@store/auth/security";
import * as React from "react";

import { useOnline } from "@/hooks/use-online";
import { authSession } from "@/lib/auth";
import {
  useAuth as useClerkAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@/lib/clerk-runtime";
import { clerkWorkspaceSyncAction } from "@/lib/clerk-session-policy";

const tokenOptions = clerkTokenOptions(import.meta.env.VITE_CLERK_JWT_TEMPLATE);

/** Activates the first Clerk org so the session token includes org context. */
export function ClerkActiveOrganization() {
  const { organization } = useOrganization();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  React.useEffect(() => {
    if (!isLoaded || organization || !setActive) return;
    const first = userMemberships.data?.[0]?.organization;
    if (first?.id) void setActive({ organization: first.id });
  }, [isLoaded, organization, setActive, userMemberships.data]);

  return null;
}

/** Pushes the Clerk session JWT to the host so sync uses store org ids. */
export function ClerkWorkspaceSync() {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? null;
  const online = useOnline();

  React.useEffect(() => {
    const action = clerkWorkspaceSyncAction({
      isLoaded,
      isSignedIn: isSignedIn === true,
      online,
    });
    if (action === "idle") return;
    if (action === "clear") {
      void authSession().adoptSession(null);
      return;
    }
    let cancelled = false;
    let refreshing = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      if (cancelled) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), delay);
    };
    const refresh = async () => {
      if (cancelled || refreshing) return;
      refreshing = true;
      clearTimeout(refreshTimer);
      let nextRefresh = 5_000;
      try {
        const token = await getToken(tokenOptions);
        if (!cancelled && token) {
          await authSession().adoptSession(token);
          nextRefresh = clerkTokenRefreshDelay(token);
        }
      } catch {
        nextRefresh = 5_000;
      } finally {
        refreshing = false;
        schedule(nextRefresh);
      }
    };
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    document.addEventListener("visibilitychange", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
    };
  }, [getToken, isLoaded, isSignedIn, online, organizationId]);

  return null;
}

export function useClerkSignOut() {
  const { signOut: clerkSignOut } = useClerk();
  return React.useCallback(async () => {
    await clerkSignOut();
    await authSession().signOut();
  }, [clerkSignOut]);
}

export const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
