import { SiteBreadcrumbs } from "@/components/app/site-breadcrumbs";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-12 w-full shrink-0 items-center bg-transparent [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]">
      <div className="flex h-12 w-full min-w-0 items-center gap-2 pr-[calc(100vw-env(titlebar-area-width,100vw)-env(titlebar-area-x,0px)+0.5rem)] pl-4">
        <SiteBreadcrumbs />
      </div>
    </header>
  );
}
