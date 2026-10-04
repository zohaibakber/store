import { useAtom } from "@effect/atom-react";
import { ComputerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi, Outlet, useMatchRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { PageLoading } from "@/components/app/loading-spinner";
import { LocalCatalogWitness } from "@/components/app/local-catalog-witness";
import { NavHistory } from "@/components/app/nav-history";
import { PublishOffer } from "@/components/app/publish-offer";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteBreadcrumbs } from "@/components/app/site-breadcrumbs";
import { TitleBar, TitleBarEnd, TitleBarSearch, TitleBarStart } from "@/components/app/title-bar";
import { WindowControls } from "@/components/app/window-controls";
import { TitleBarInsightsFreshness } from "@/components/insights/freshness";
import { ReceiptPrintHost } from "@/components/receipts/print-host";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { InventoryProvider, InventoryReady } from "@/lib/inventory/provider";
import { WorkspaceSyncAction } from "@/lib/inventory/sync-status";
import { sidebarOpenAtom } from "@/lib/preferences";

const route = getRouteApi("/_app");

function InventoryOnDesktop() {
  return (
    <Empty className="min-h-[calc(100svh-4rem)]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={ComputerIcon} />
        </EmptyMedia>
        <EmptyTitle>Inventory is in the desktop app</EmptyTitle>
        <EmptyDescription>
          Products, sales and purchases are available in the Tabaaq desktop app.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ReplicaFreeContent() {
  const onSettings = useMatchRoute()({ to: "/settings", fuzzy: true }) !== false;
  if (!onSettings) return <InventoryOnDesktop />;
  return (
    <Suspense fallback={<PageLoading />}>
      <Outlet />
    </Suspense>
  );
}

export function AppShell() {
  const { inventory, catalog } = route.useRouteContext();
  const { workspace } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);

  const lease = catalog.lease();
  const host = inventory._tag === "Replica" ? inventory.host : null;
  const shell = (
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
              <TitleBarInsightsFreshness />
              <WorkspaceSyncAction workspace={workspace} />
              <WindowControls />
            </TitleBarEnd>
          </TitleBar>
          <div className="flex min-h-0 flex-1">
            <AppSidebar className="top-10 h-auto" />
            <SidebarInset
              className="min-h-0 scrollbar-none overflow-y-auto"
              data-scroll-restoration-id="app-content"
            >
              <LocalCatalogWitness workspace={workspace} />
              {inventory._tag === "NoReplica" ? (
                <ReplicaFreeContent />
              ) : host && lease ? (
                <InventoryReady>
                  <PublishOffer />
                  <ReceiptPrintHost />
                  <Suspense fallback={<PageLoading />}>
                    <Outlet />
                  </Suspense>
                </InventoryReady>
              ) : (
                <p className="p-6 text-sm text-destructive">Catalog storage is unavailable.</p>
              )}
            </SidebarInset>
          </div>
        </SidebarProvider>
      </CommandMenuProvider>
    </TooltipProvider>
  );

  if (!host || !lease) return shell;
  return (
    <InventoryProvider catalog={catalog} host={host} lease={lease}>
      {shell}
    </InventoryProvider>
  );
}
