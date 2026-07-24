import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NavHistory() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useRouterState({
    select: (state) => state.location.state.__TSR_index < router.history.length - 1,
  });

  return (
    <div className="flex items-center gap-0.5">
      <Button
        aria-label="Go back"
        disabled={!canGoBack}
        onClick={() => router.history.back()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} />
      </Button>
      <Button
        aria-label="Go forward"
        disabled={!canGoForward}
        onClick={() => router.history.forward()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon icon={ArrowRight01Icon} />
      </Button>
    </div>
  );
}
