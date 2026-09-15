import { NavUser } from "@/components/app/nav-user";
import { SiteBreadcrumbs } from "@/components/app/site-breadcrumbs";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  return (
    <header className="titlebar-end-padding sticky top-0 z-10 flex h-10 shrink-0 items-center gap-2 [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator className="mr-2 h-4" orientation="vertical" />
        <SiteBreadcrumbs />
      </div>
      <div className="ml-auto flex items-center gap-2 px-2">
        <NavUser />
      </div>
    </header>
  );
}
