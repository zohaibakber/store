import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { NotFound } from "@/components/app/not-found";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteHeader } from "@/components/app/site-header";
import { CreateOrganizationPage } from "@/components/auth/create-organization-page";
import { AuthPage } from "@/components/auth/page";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppUpdater } from "@/hooks/use-app-updater";
import { AuthProvider, type InitialAuth, useAuth } from "@/lib/auth";
import type { Store } from "@/lib/store";

export interface RouterContext {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

export function RootLayout() {
  const { initialAuth } = Route.useRouteContext();
  useAppUpdater();
  return (
    <AuthProvider initial={initialAuth}>
      <ToastProvider>
        <AuthenticatedLayout />
      </ToastProvider>
    </AuthProvider>
  );
}

function AuthenticatedLayout() {
  const { snapshot, loading, error } = useAuth();
  if (loading) return null;
  if (!snapshot || snapshot.status === "unauthenticated") return <AuthPage bridgeError={error} />;
  if (!snapshot.activeOrganization) return <CreateOrganizationPage />;
  return (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider className="h-svh min-h-0 overflow-hidden">
          <AppSidebar />
          <SidebarInset className="min-h-0 scrollbar-none overflow-y-auto">
            <SiteHeader />
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </CommandMenuProvider>
    </TooltipProvider>
  );
}
