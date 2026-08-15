import * as React from "react";

import { AuthBrand } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { clerkAppearance, SignIn, useAuth as useClerkAuth } from "@/lib/clerk-runtime";
import { clerkPublishableKey, useClerkSignOut } from "@/lib/clerk-workspace";

function ClerkSignInPanel({ bridgeError }: { bridgeError?: string | null }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const signOut = useClerkSignOut();
  const [signingOut, setSigningOut] = React.useState(false);

  if (!isLoaded || (isSignedIn && !bridgeError)) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner aria-label="Finishing sign-in" className="size-4" />
        <span>Finishing sign-in…</span>
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <Alert variant="error">
        <AlertTitle>Could not finish sign-in</AlertTitle>
        <AlertDescription>
          <span>{bridgeError}</span>
          <Button
            className="self-start"
            loading={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut().catch(() => setSigningOut(false));
            }}
            type="button"
            variant="outline"
          >
            Sign out and try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <SignIn appearance={clerkAppearance} routing="hash" />
      {bridgeError ? (
        <Alert className="mt-6" variant="error">
          <AlertTitle>Sign-in is not ready</AlertTitle>
          <AlertDescription>{bridgeError}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

export function AuthPage({ bridgeError }: { bridgeError?: string | null }) {
  return (
    <div className="relative flex min-h-svh flex-col">
      <header className="absolute inset-x-0 top-0 z-10 h-12 [-webkit-app-region:drag]" />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 md:p-10">
        <AuthBrand />
        <div className="flex w-full justify-center">
          <div className="w-full max-w-xs">
            {clerkPublishableKey ? (
              <ClerkSignInPanel bridgeError={bridgeError} />
            ) : (
              <Alert>
                <AlertTitle>Clerk is not configured</AlertTitle>
                <AlertDescription>
                  Set VITE_CLERK_PUBLISHABLE_KEY so sign-in can load.
                </AlertDescription>
              </Alert>
            )}
            {!clerkPublishableKey && bridgeError ? (
              <Alert className="mt-6">
                <AlertTitle>Offline sign-in is not ready</AlertTitle>
                <AlertDescription>{bridgeError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
