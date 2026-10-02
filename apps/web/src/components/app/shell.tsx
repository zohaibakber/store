import { useAtom } from "@effect/atom-react";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { Suspense } from "react";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { PageLoading } from "@/components/app/loading-spinner";
import { LocalCatalogWitness } from "@/components/app/local-catalog-witness";
import { PublishOffer } from "@/components/app/publish-offer";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteHeader } from "@/components/app/site-header";
import { PageActionsProvider } from "@/components/shared/page-actions";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { InventoryProvider, InventoryReady } from "@/lib/inventory/provider";
import { sidebarOpenAtom } from "@/lib/preferences";

const route = getRouteApi("/_app");

export function AppShell() {
  const { inventory, catalog } = route.useRouteContext();
  const { workspace } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);

  const lease = catalog.lease();
  const shell = (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider
          className="h-svh min-h-0 overflow-hidden"
          onOpenChange={setSidebarOpen}
          open={sidebarOpen}
        >
          <AppSidebar />
          <SidebarInset
            className="min-h-0 scrollbar-none overflow-y-auto"
            data-scroll-restoration-id="app-content"
          >
            <PageActionsProvider>
              <SiteHeader />
              <LocalCatalogWitness workspace={workspace} />
              {inventory && lease ? (
                <InventoryReady>
                  <PublishOffer />
                  <Suspense fallback={<PageLoading />}>
                    <Outlet />
                  </Suspense>
                </InventoryReady>
              ) : (
                <p className="p-6 text-sm text-destructive">Catalog storage is unavailable.</p>
              )}
            </PageActionsProvider>
          </SidebarInset>
        </SidebarProvider>
      </CommandMenuProvider>
    </TooltipProvider>
  );

  if (!inventory || !lease) return shell;
  return (
    <InventoryProvider catalog={catalog} host={inventory} lease={lease}>
      {shell}
    </InventoryProvider>
  );
}
