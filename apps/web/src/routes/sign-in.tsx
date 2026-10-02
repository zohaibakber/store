import { createFileRoute } from "@tanstack/react-router";

import { AppLoading } from "@/components/app/loading";
import { AuthForm, AuthScreen, useGoogleCallback } from "@/components/auth/page";
import { Button } from "@/components/ui/button";
import { useOpenWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/sign-in")({
  component: SignInRoute,
  staticData: { breadcrumb: "Sign in" },
});

function ContinueWithoutAccount() {
  const openWorkspace = useOpenWorkspace();
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Button className="w-full" onClick={() => openWorkspace("local")} variant="ghost">
        Continue without an account
      </Button>
      <p className="text-xs text-muted-foreground">
        Products, stock and sales stay on this device. Sign in later to sync them.
      </p>
    </div>
  );
}

function SignInRoute() {
  const { access } = Route.useRouteContext();
  const callback = useGoogleCallback();
  if (callback.completing) return <AppLoading label="Signing in" />;
  return (
    <AuthScreen>
      <div className="flex flex-col gap-6">
        <AuthForm callbackError={callback.error} />
        {access.localWorkspace ? <ContinueWithoutAccount /> : null}
      </div>
    </AuthScreen>
  );
}
