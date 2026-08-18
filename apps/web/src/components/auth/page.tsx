import * as React from "react";

import { AuthScreen } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useOnline } from "@/hooks/use-online";
import { SignIn, useAuth as useClerkAuth } from "@/lib/clerk-runtime";
import { clerkPublishableKey, useClerkSignOut } from "@/lib/clerk-workspace";

function SignOutAlert({ message }: { message?: string | null }) {
  const signOut = useClerkSignOut();
  const [signingOut, setSigningOut] = React.useState(false);

  return (
    <Alert className="w-full max-w-xs" variant="error">
      <AlertTitle>Could not finish sign-in</AlertTitle>
      <AlertDescription>
        <span>
          {message ??
            "This Clerk session is not accepted by the workspace. Sign out and use another account."}
        </span>
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

function ClerkSignInPanel({ bridgeError }: { bridgeError?: string | null }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const online = useOnline();

  if (!isLoaded) {
    if (!online) {
      return (
        <Alert className="w-full max-w-xs">
          <AlertTitle>You’re offline</AlertTitle>
          <AlertDescription>
            Sign-in needs a connection the first time. After that, this device keeps the catalog
            locally.
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Spinner aria-label="Loading sign-in" className="size-6" />
      </div>
    );
  }

  if (isSignedIn && !bridgeError) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Spinner aria-label="Finishing sign-in" className="size-6" />
      </div>
    );
  }

  if (isSignedIn) {
    return <SignOutAlert message={bridgeError} />;
  }

  return (
    <div className="flex w-full flex-col items-center">
      <div className="flex w-full justify-center">
        <SignIn routing="hash" />
      </div>
      {bridgeError ? (
        <Alert className="mt-6 w-full max-w-xs" variant="error">
          <AlertTitle>Sign-in is not ready</AlertTitle>
          <AlertDescription>{bridgeError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function AuthPage({ bridgeError }: { bridgeError?: string | null }) {
  return (
    <AuthScreen>
      <div className="flex w-full flex-col items-center">
        {clerkPublishableKey ? (
          <ClerkSignInPanel bridgeError={bridgeError} />
        ) : (
          <Alert className="w-full max-w-xs">
            <AlertTitle>Clerk is not configured</AlertTitle>
            <AlertDescription>Set VITE_CLERK_PUBLISHABLE_KEY so sign-in can load.</AlertDescription>
          </Alert>
        )}
        {!clerkPublishableKey && bridgeError ? (
          <Alert className="mt-6 w-full max-w-xs">
            <AlertTitle>Offline sign-in is not ready</AlertTitle>
            <AlertDescription>{bridgeError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </AuthScreen>
  );
}
