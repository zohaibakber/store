import { createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/components/auth/brand";
import { AuthForm } from "@/components/auth/page";

export const Route = createFileRoute("/sign-in")({
  component: SignInRoute,
  staticData: { breadcrumb: "Sign in" },
});

function SignInRoute() {
  return (
    <AuthScreen>
      <AuthForm />
    </AuthScreen>
  );
}
