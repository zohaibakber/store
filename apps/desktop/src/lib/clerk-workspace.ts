import { clerkTokenOptions } from "@store/auth/security";
import type { WorkspaceSnapshot } from "@store/contracts";
import * as React from "react";

import { authSession } from "@/lib/auth";
import {
  useAuth as useClerkAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@/lib/clerk-runtime";

const tokenOptions = clerkTokenOptions(import.meta.env.VITE_CLERK_JWT_TEMPLATE);

export const clerkSessionTokenOptions = tokenOptions;

/**
 * Prefer a Clerk organization that is mapped to a different store id. That is
 * the legacy Tabaaq workspace; newly-created organizations use their Clerk id
 * as their store id and must not displace existing inventory.
 */
export const preferredClerkOrganizationId = (snapshot: WorkspaceSnapshot) => {
  const legacy = snapshot.organizations.find(
    (organization) =>
      organization.clerkOrganizationId && organization.id !== organization.clerkOrganizationId,
  );
  return legacy?.clerkOrganizationId ?? snapshot.organizations[0]?.clerkOrganizationId ?? null;
};

export const createAndActivateOrganization = async (input: {
  readonly name: string;
  readonly createOrganization: (input: {
    readonly name: string;
  }) => Promise<{ readonly id: string }>;
  readonly setActive: (organizationId: string) => Promise<unknown>;
  readonly getToken: () => Promise<string | null>;
  readonly adoptSession: (token: string) => Promise<unknown>;
}) => {
  const created = await input.createOrganization({ name: input.name });
  await activateOrganizationSession({ ...input, organizationId: created.id });
  return created;
};

export const activateOrganizationSession = async (input: {
  readonly organizationId: string;
  readonly setActive: (organizationId: string) => Promise<unknown>;
  readonly getToken: () => Promise<string | null>;
  readonly adoptSession: (token: string) => Promise<unknown>;
}) => {
  await input.setActive(input.organizationId);
  const token = await input.getToken();
  if (!token) throw new Error("The organization session could not be activated.");
  await input.adoptSession(token);
};

/** Pushes the Clerk session JWT to the host so sync uses store org ids. */
export function ClerkWorkspaceSync() {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { organization } = useOrganization();
  const { setActive } = useOrganizationList();
  const organizationId = organization?.id ?? null;

  React.useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      void authSession().adoptSession(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const token = await getToken(tokenOptions);
      if (cancelled || !token) return;
      const snapshot = await authSession().adoptSession(token);
      if (cancelled || organizationId || !setActive) return;

      const preferred = preferredClerkOrganizationId(snapshot);
      if (!preferred) return;
      await setActive({ organization: preferred });

      // setActive refreshes Clerk's session claims. Fetch a fresh token and
      // adopt it immediately instead of waiting for another render/effect.
      const activeToken = await getToken(tokenOptions);
      if (!cancelled && activeToken) await authSession().adoptSession(activeToken);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, organizationId, setActive]);

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
