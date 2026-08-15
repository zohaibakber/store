import { ClerkProvider, useAuth, useOrganization, useOrganizationList, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { type PropsWithChildren, useEffect, useRef } from "react";

import {
  clerkPublishableKey,
  mobileClerkTokenOptions,
  setAccessTokenProvider,
} from "@/lib/auth-client";

function ClerkActiveOrganization() {
  const { isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const { organization } = useOrganization();
  const { createOrganization, isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const bootstrapAttempted = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || organization || !setActive || !userMemberships.data) return;
    const first = userMemberships.data?.[0]?.organization;
    if (first?.id) {
      void setActive({ organization: first.id });
      return;
    }
    if (!createOrganization || bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;
    const owner = user?.firstName?.trim() || user?.fullName?.trim() || "My";
    void createOrganization({ name: `${owner}'s Store` })
      .then((created) => setActive({ organization: created.id }))
      .catch(() => {
        bootstrapAttempted.current = false;
      });
  }, [
    createOrganization,
    isLoaded,
    isSignedIn,
    organization,
    setActive,
    user?.firstName,
    user?.fullName,
    userMemberships.data,
  ]);

  return null;
}

function ClerkTokenBridge() {
  const { getToken, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
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
