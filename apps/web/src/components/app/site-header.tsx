import { SiteBreadcrumbs } from "@/components/app/site-breadcrumbs";
import { PageActionsSlot } from "@/components/shared/page-actions";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  return (
    <header className="titlebar-end-padding sticky top-0 z-10 flex h-10 shrink-0 items-center gap-2 bg-background [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]">
      <div className="flex min-w-0 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator className="mr-2 h-4" orientation="vertical" />
        <SiteBreadcrumbs />
      </div>
      <PageActionsSlot className="ms-auto" />
    </header>
  );
}
