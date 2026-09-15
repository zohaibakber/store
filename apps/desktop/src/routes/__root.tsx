import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { AppLoading } from "@/components/app/loading";
import { NotFound } from "@/components/app/not-found";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteHeader } from "@/components/app/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppUpdater } from "@/hooks/use-app-updater";
import type { HostAccessPolicy } from "@/host-access";
import { AuthProvider, useAuth } from "@/lib/auth";
import { InventoryProvider, InventoryReady } from "@/lib/inventory-db";
import type { InventoryHost } from "@/lib/inventory-host";
import type { CatalogLifetime } from "@/lib/inventory/lifetime";
import type { ReplayChannel } from "@/replay-channel";
import type { WorkspaceSession } from "@/session/workspace-session";

export interface RouterContext {
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime;
  readonly access: HostAccessPolicy;
  readonly inventory: InventoryHost | null;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    const snapshot = context.session.current()?.snapshot ?? null;
    const verdict = context.access.admit({
      location: { pathname: location.pathname },
      snapshot,
    });
    if (verdict._tag === "Redirect") {
      throw redirect({ to: verdict.to, replace: verdict.replace });
    }
  },
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

export function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppUpdater />
        <AuthenticatedLayout />
      </ToastProvider>
    </AuthProvider>
  );
}

function AppUpdater() {
  useAppUpdater();
  return null;
}

function AuthenticatedLayout() {
  const auth = useAuth();
  if (auth._tag === "Loading") return <AppLoading />;
  return <AppShell />;
}

function AppShell() {
  const { access, inventory, catalog } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const chrome = access.chrome({ pathname });
  if (chrome._tag === "Bare") return <Outlet />;

  const lease = catalog.lease();
  const shell = (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider className="h-svh min-h-0 overflow-hidden" defaultOpen={false}>
          <AppSidebar />
          <SidebarInset className="min-h-0 scrollbar-none overflow-y-auto">
            <SiteHeader />
            {inventory && lease ? (
              <InventoryReady>
                <Outlet />
              </InventoryReady>
            ) : (
              <p className="p-6 text-sm text-destructive">Catalog storage is unavailable.</p>
            )}
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
