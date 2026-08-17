import { ClerkProvider, useAuth, useOrganization, useOrganizationList, useUser } from "@clerk/expo";
import { resourceCache } from "@clerk/expo/resource-cache";
import { tokenCache } from "@clerk/expo/token-cache";
import { type PropsWithChildren, useEffect, useRef } from "react";

import {
  clerkPublishableKey,
  isDeviceOffline,
  isOfflineCause,
  mobileClerkTokenOptions,
  setAccessTokenProvider,
} from "@/lib/auth-client";
import { rememberLastUserId } from "@/lib/local-session";

function ClerkActiveOrganization() {
  const { isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  return isSignedIn ? <ClerkActiveOrganizationSession /> : null;
}

function ClerkActiveOrganizationSession() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const { createOrganization, isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const bootstrapAttempted = useRef(false);

  useEffect(() => {
    if (!isLoaded || organization || !setActive || !userMemberships.data) return;
    const first = userMemberships.data?.[0]?.organization;
    if (first?.id) {
      void setActive({ organization: first.id });
      return;
    }
    if (!createOrganization || bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;
    const owner = user?.firstName?.trim() || user?.fullName?.trim() || "My";
    void (async () => {
      if (await isDeviceOffline()) {
        bootstrapAttempted.current = false;
        return;
      }
      try {
        const created = await createOrganization({ name: `${owner}'s Store` });
        await setActive({ organization: created.id });
      } catch {
        bootstrapAttempted.current = false;
      }
    })();
  }, [
    createOrganization,
    isLoaded,
    organization,
    setActive,
    user?.firstName,
    user?.fullName,
    userMemberships.data,
  ]);

  return null;
}

function ClerkTokenBridge() {
  const { getToken, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  return isSignedIn ? (
    <ClerkSignedInTokenBridge getToken={getToken} userId={userId} />
  ) : (
    <ClerkSignedOutTokenBridge />
  );
}

function ClerkSignedOutTokenBridge() {
  useEffect(() => {
    setAccessTokenProvider(async () => null);
    return () => setAccessTokenProvider(async () => null);
  }, []);
  return null;
}

function ClerkSignedInTokenBridge({
  getToken,
  userId,
}: {
  getToken: ReturnType<typeof useAuth>["getToken"];
  userId: string | null | undefined;
}) {
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? null;

  useEffect(() => {
    if (userId) void rememberLastUserId(userId);
  }, [userId]);

  useEffect(() => {
    setAccessTokenProvider(async () => {
      try {
        return await getToken(mobileClerkTokenOptions);
      } catch (error) {
        if (!isOfflineCause(error)) throw error;
        if (!mobileClerkTokenOptions) return null;
        try {
          return await getToken();
        } catch {
          return null;
        }
      }
    });
    return () => setAccessTokenProvider(async () => null);
  }, [getToken, organizationId]);

  return null;
}

export function MobileClerkProvider({ children }: PropsWithChildren) {
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      tokenCache={tokenCache}
      __experimental_resourceCache={resourceCache}
    >
      <ClerkActiveOrganization />
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  );
}
