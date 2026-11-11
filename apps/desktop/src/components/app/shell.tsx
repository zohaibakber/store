import { useAtom, useAtomValue } from "@effect/atom-react";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { Suspense, type ReactNode } from "react";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { PageLoading } from "@/components/app/loading-spinner";
import { NavHistory } from "@/components/app/nav-history";
import { PublishOffer } from "@/components/app/publish-offer";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteBreadcrumbs } from "@/components/app/site-breadcrumbs";
import { TitleBar, TitleBarEnd, TitleBarSearch, TitleBarStart } from "@/components/app/title-bar";
import { WindowControls } from "@/components/app/window-controls";
import { ReceiptPrintHost } from "@/components/receipts/print-host";
import { StaffGate, StaffRouteGuard } from "@/components/staff/gate";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { claimedCatalogScope } from "@/inventory/opening";
import { InventoryProvider, InventoryReady } from "@/inventory/provider";
import { WorkspaceSyncAction } from "@/inventory/sync-status";
import { useAuth } from "@/lib/auth";
import { useLocalCatalogWitness } from "@/lib/local-catalog-witness";
import { sidebarOpenAtom } from "@/lib/preferences";

const route = getRouteApi("/_app");

const CATALOG_UNAVAILABLE = "Catalog storage is unavailable.";

export function AppShell() {
  const { inventory } = route.useRouteContext();
  const scope = useAtomValue(claimedCatalogScope);
  if (Option.isNone(scope)) return <ShellFrame content={<CatalogUnavailable />} />;
  return (
    <InventoryProvider opening={inventory.catalog(scope.value)}>
      <StaffGate>
        <ShellFrame
          content={
            <InventoryReady>
              <PublishOffer />
              <ReceiptPrintHost />
              <StaffRouteGuard>
                <Suspense fallback={<PageLoading />}>
                  <Outlet />
                </Suspense>
              </StaffRouteGuard>
            </InventoryReady>
          }
        />
      </StaffGate>
    </InventoryProvider>
  );
}

function CatalogUnavailable() {
  return <p className="p-6 text-sm text-destructive">{CATALOG_UNAVAILABLE}</p>;
}

function ShellFrame({ content }: { readonly content: ReactNode }) {
  const { workspace } = useAuth();
  useLocalCatalogWitness(workspace);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  return (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider
          className="h-svh min-h-0 flex-col overflow-hidden"
          onOpenChange={setSidebarOpen}
          open={sidebarOpen}
        >
          <TitleBar>
            <TitleBarStart>
              <SidebarTrigger />
              <NavHistory />
              <Separator className="h-4" orientation="vertical" />
              <SiteBreadcrumbs />
            </TitleBarStart>
            <TitleBarSearch />
            <TitleBarEnd>
              <WorkspaceSyncAction />
              <WindowControls />
            </TitleBarEnd>
          </TitleBar>
          <div className="flex min-h-0 flex-1">
            <AppSidebar className="top-10 h-auto" />
            <SidebarInset
              className="min-h-0 scrollbar-none overflow-y-auto"
              data-scroll-restoration-id="app-content"
            >
              {content}
            </SidebarInset>
          </div>
        </SidebarProvider>
      </CommandMenuProvider>
    </TooltipProvider>
  );
}
