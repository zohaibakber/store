import { Alert02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function RouteError({
  error,
  reset,
  onRetry,
}: ErrorComponentProps & { readonly onRetry?: () => void }) {
  const router = useRouter();
  const message = error instanceof Error && error.message ? error.message : "Something went wrong.";
  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <Alert variant="error">
        <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
        <AlertTitle>This page could not load</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
        <AlertAction>
          <Button
            onClick={() => {
              onRetry?.();
              reset();
              void router.invalidate();
            }}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={RefreshIcon} />
            Try again
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
