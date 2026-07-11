import { SearchForm } from "@/components/search-form";
import { WindowControls } from "@/components/window-controls";
import { Button } from "@/components/ui/button";
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft01Icon, ArrowRight01Icon, CommandIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function SiteHeader() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useRouterState({
    select: (state) => state.location.state.__TSR_index < router.history.length - 1,
  });

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-background [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]">
      <div className="flex h-(--header-height) w-full items-center px-2">
        <div className="flex items-center gap-1">
          <Button size={"icon"} variant={"ghost"}>
            <HugeiconsIcon icon={CommandIcon} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Go back"
            disabled={!canGoBack}
            onClick={() => router.history.back()}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Go forward"
            disabled={!canGoForward}
            onClick={() => router.history.forward()}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} />
          </Button>
        </div>
        <SearchForm className="w-full sm:ml-auto sm:w-auto" />
        <WindowControls />
      </div>
    </header>
  );
}
