import { useAuth, useOrganization, useOrganizationList } from "@clerk/electron/react";
import { clerkTokenOptions } from "@store/auth/security";
import * as React from "react";

const tokenOptions = clerkTokenOptions(import.meta.env.VITE_CLERK_JWT_TEMPLATE);

/** Activates a Clerk org so the session JWT includes `org_id` for Worker auth. */
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

/** Pushes the Clerk session JWT to the main process so sync uses store org ids. */
export function ClerkWorkspaceSync() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? null;

  React.useEffect(() => {
    if (!isLoaded || !window.auth) return;
    if (!isSignedIn) {
      void window.auth.adoptSession(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const token = await getToken(tokenOptions);
      if (!cancelled && token) await window.auth?.adoptSession(token);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, organizationId]);

  return null;
}

export const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
