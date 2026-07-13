import { WindowControls } from "@/components/window-controls";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function SiteHeader() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useRouterState({
    select: (state) => state.location.state.__TSR_index < router.history.length - 1,
  });
  const { state, isMobile } = useSidebar();
  const showSidebarTrigger = isMobile || state === "collapsed";

  return (
    <header className="sticky top-0 z-50 flex w-full items-center bg-background [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]">
      <div className="flex h-(--header-height) w-full items-center px-2">
        <div className="flex items-center gap-1">
          {showSidebarTrigger && (
            <>
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-1 h-4 my-auto" />
            </>
          )}
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
        <WindowControls />
      </div>
    </header>
  );
}
