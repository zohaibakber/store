import { ClerkProvider, useAuth, useOrganization, useOrganizationList } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { type PropsWithChildren, useEffect } from "react";

import {
  clerkPublishableKey,
  mobileClerkTokenOptions,
  setAccessTokenProvider,
} from "@/lib/auth-client";

function ClerkActiveOrganization() {
  const { organization } = useOrganization();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  useEffect(() => {
    if (!isLoaded || organization || !setActive) return;
    const first = userMemberships.data?.[0]?.organization;
    if (first?.id) void setActive({ organization: first.id });
  }, [isLoaded, organization, setActive, userMemberships.data]);

  return null;
}

function ClerkTokenBridge() {
  const { getToken, isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? null;

  useEffect(() => {
    setAccessTokenProvider(() =>
      isSignedIn ? getToken(mobileClerkTokenOptions) : Promise.resolve(null),
    );
    return () => setAccessTokenProvider(async () => null);
  }, [getToken, isSignedIn, organizationId]);

  return null;
}

export function MobileClerkProvider({ children }: PropsWithChildren) {
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
      <ClerkActiveOrganization />
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  );
}
