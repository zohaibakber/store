import { createFileRoute } from "@tanstack/react-router";

import { AppLoading } from "@/components/app/loading";
import { AuthScreen } from "@/components/auth/brand";
import { AuthForm, useGoogleCallback } from "@/components/auth/page";

export const Route = createFileRoute("/sign-in")({
  component: SignInRoute,
  staticData: { breadcrumb: "Sign in" },
});

function SignInRoute() {
  const callback = useGoogleCallback();
  if (callback.completing) return <AppLoading label="Signing in" />;
  return (
    <AuthScreen>
      <AuthForm callbackError={callback.error} />
    </AuthScreen>
  );
}
