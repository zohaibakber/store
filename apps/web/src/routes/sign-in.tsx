import { ArrowLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { AuthScreen } from "@/components/auth/brand";
import { AuthForm } from "@/components/auth/page";
import { Button } from "@/components/ui/button";
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
      <div className="flex w-full max-w-sm flex-col gap-5">
        <AuthForm />
        <Button onClick={() => void navigate({ to: "/" })} type="button" variant="ghost">
          <HugeiconsIcon aria-hidden="true" icon={ArrowLeftIcon} />
          Continue without signing in
        </Button>
      </div>
    </AuthScreen>
  );
}
