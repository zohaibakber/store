import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { AuthScreen } from "@/components/auth/brand";
import { AuthForm } from "@/components/auth/page";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInRoute,
  staticData: { breadcrumb: "Sign in" },
});

function SignInRoute() {
  const auth = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (auth.snapshot?.status === "authenticated") {
      void navigate({ to: "/" });
    }
  }, [auth.snapshot, navigate]);

  return (
    <AuthScreen>
      <AuthForm />
    </AuthScreen>
  );
}
