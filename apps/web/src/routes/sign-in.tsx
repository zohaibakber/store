import { ArrowLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { AuthScreen } from "@/components/auth/brand";
import { AuthForm } from "@/components/auth/page";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/sign-in")({
  component: SignInRoute,
  staticData: { breadcrumb: "Sign in" },
});

function SignInRoute() {
  const router = useRouter();
  return (
    <AuthScreen>
      <div className="flex w-full max-w-sm flex-col gap-5">
        <AuthForm />
        <Button
          disabled={false}
          onClick={() => router.history.back()}
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden="true" icon={ArrowLeftIcon} />
          Continue without signing in
        </Button>
      </div>
    </AuthScreen>
  );
}
