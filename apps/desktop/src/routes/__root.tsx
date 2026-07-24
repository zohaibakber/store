import { createRootRoute, Outlet } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { AuthPage } from "@/components/auth/page";
import { CommandMenuProvider } from "@/components/command-menu";
import { CreateOrganizationPage } from "@/components/create-organization-page";
import { NotFound } from "@/components/not-found";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppUpdater } from "@/hooks/use-app-updater";
import { AuthProvider, useAuth } from "@/lib/auth";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

export function RootLayout() {
  // Mounted at the root so update toasts also reach the auth screen.
  useAppUpdater();
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthenticatedLayout />
      </ToastProvider>
    </AuthProvider>
  );
}

function AuthenticatedLayout() {
  const { snapshot, loading, error } = useAuth();
  // Hide the previous tenant while its active route is being reloaded against
  // the newly activated organization.
  if (loading) return null;
  if (!snapshot || snapshot.status === "unauthenticated") return <AuthPage bridgeError={error} />;
  if (!snapshot.activeOrganization) return <CreateOrganizationPage />;
  return (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider className="h-svh min-h-0 overflow-hidden">
          <AppSidebar />
          <SidebarInset className="min-h-0 scrollbar-gutter-stable overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-button]:w-0 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
            <SiteHeader />
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </CommandMenuProvider>
    </TooltipProvider>
  );
}
